import Foundation
import Security
@MainActor protocol CredentialStorage {
    func load(_ server: String) throws -> Data?
    func save(_ data: Data, server: String) throws
    func remove(_ server: String)
}
struct KeychainCredentialStorage: CredentialStorage {
    func load(_ server: String) throws -> Data? { try CredentialStore.load(server) }
    func save(_ data: Data, server: String) throws { try CredentialStore.save(data, server: server) }
    func remove(_ server: String) { CredentialStore.remove(server) }
}
enum CredentialStore {
    private static func query(_ server: String) -> [String:Any] { [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"com.openterminal.device",kSecAttrAccount as String:server,kSecAttrSynchronizable as String:false] }
    static func load(_ server: String) throws -> Data? {
        var q=query(server); q[kSecReturnData as String]=true; q[kSecMatchLimit as String]=kSecMatchLimitOne
        var result:CFTypeRef?; let status=SecItemCopyMatching(q as CFDictionary,&result)
        if status==errSecItemNotFound{return nil};guard status==errSecSuccess else{throw NSError(domain:NSOSStatusErrorDomain,code:Int(status))};return result as? Data
    }
    static func save(_ data: Data, server: String) throws {
        let q=query(server),values:[String:Any]=[kSecValueData as String:data,kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let update=SecItemUpdate(q as CFDictionary,values as CFDictionary)
        let status=update==errSecItemNotFound ? SecItemAdd(q.merging(values){_,new in new} as CFDictionary,nil) : update
        guard status==errSecSuccess else{throw NSError(domain:NSOSStatusErrorDomain,code:Int(status))}
    }
    static func remove(_ server: String) { SecItemDelete(query(server) as CFDictionary) }
}
// The model awaits a token for its own session instead of consuming unscoped notifications.
@MainActor protocol NativeNotificationAccess {
    var supported: Bool { get }
    func requestAuthorization() async throws -> Bool
    func isAuthorized() async -> Bool
    func register() async throws -> String
}
private enum PushRegistrationError: LocalizedError {
    case unsupported, timedOut
    var errorDescription: String? {
        switch self {
        case .unsupported: nativeText("Native registration requires an iPhone or iPad.")
        case .timedOut: nativeText("Notification registration timed out. Please retry.")
        }
    }
}
@MainActor struct SystemNotificationAccess: NativeNotificationAccess {
    var supported: Bool {
        #if os(iOS)
        true
        #else
        false
        #endif
    }
    func requestAuthorization() async throws -> Bool {
        #if os(iOS)
        try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        #else
        throw PushRegistrationError.unsupported
        #endif
    }
    func isAuthorized() async -> Bool {
        #if os(iOS)
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return settings.authorizationStatus == .authorized
        #else
        return false
        #endif
    }
    func register() async throws -> String {
        #if os(iOS)
        return try await NativePushTokens.shared.request { UIApplication.shared.registerForRemoteNotifications() }
        #else
        throw PushRegistrationError.unsupported
        #endif
    }
}
// APNs tokens identify this app/device, so concurrent callers can share one OS request.
// Each awaiting model operation still checks its own login session before sending the token.
@MainActor final class NativePushTokens {
    static let shared = NativePushTokens()
    private var waiters: [UUID: CheckedContinuation<String, Error>] = [:]
    private var deadline: Task<Void, Never>?
    func request(timeout: Duration = .seconds(30), start: () -> Void) async throws -> String {
        let id = UUID()
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                let first = waiters.isEmpty
                waiters[id] = continuation
                if first {
                    deadline = Task { [weak self] in
                        do { try await Task.sleep(for: timeout) } catch { return }
                        self?.complete(.failure(PushRegistrationError.timedOut))
                    }
                    start()
                }
            }
        } onCancel: {
            Task { @MainActor in
                self.waiters.removeValue(forKey: id)?.resume(throwing: CancellationError())
                if self.waiters.isEmpty { self.deadline?.cancel(); self.deadline = nil }
            }
        }
    }
    func complete(_ result: Result<String, Error>) {
        let pending = waiters.values; waiters = [:]
        deadline?.cancel(); deadline = nil
        for continuation in pending { continuation.resume(with: result) }
    }
}
#if os(iOS)
import UIKit
import UserNotifications
@MainActor final class PhoneDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application:UIApplication,didFinishLaunchingWithOptions launchOptions:[UIApplication.LaunchOptionsKey:Any]?=nil)->Bool { UNUserNotificationCenter.current().delegate=self;return true }
    func application(_ application:UIApplication,didRegisterForRemoteNotificationsWithDeviceToken deviceToken:Data){NativePushTokens.shared.complete(.success(deviceToken.map{String(format:"%02x",$0)}.joined()))}
    func application(_ application:UIApplication,didFailToRegisterForRemoteNotificationsWithError error:Error){NativePushTokens.shared.complete(.failure(error))}
    nonisolated func userNotificationCenter(_ center:UNUserNotificationCenter,didReceive response:UNNotificationResponse)async{
        let symbol=response.notification.request.content.userInfo["symbol"] as? String
        await MainActor.run {if let symbol{NotificationCenter.default.post(name:.init("terminal-open-research"),object:symbol)}}
    }
    nonisolated func userNotificationCenter(_ center:UNUserNotificationCenter,willPresent notification:UNNotification)async->UNNotificationPresentationOptions{[.banner,.sound,.list]}
}
#endif
