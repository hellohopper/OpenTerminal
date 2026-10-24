import Foundation
import Security
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
#if os(iOS)
import UIKit
import UserNotifications
@MainActor final class PhoneDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application:UIApplication,didFinishLaunchingWithOptions launchOptions:[UIApplication.LaunchOptionsKey:Any]?=nil)->Bool { UNUserNotificationCenter.current().delegate=self;return true }
    func application(_ application:UIApplication,didRegisterForRemoteNotificationsWithDeviceToken deviceToken:Data){NotificationCenter.default.post(name:.init("terminal-push-token"),object:deviceToken.map{String(format:"%02x",$0)}.joined())}
    func application(_ application:UIApplication,didFailToRegisterForRemoteNotificationsWithError error:Error){NotificationCenter.default.post(name:.init("terminal-push-error"),object:error.localizedDescription)}
    nonisolated func userNotificationCenter(_ center:UNUserNotificationCenter,didReceive response:UNNotificationResponse)async{
        let symbol=response.notification.request.content.userInfo["symbol"] as? String
        await MainActor.run {if let symbol{NotificationCenter.default.post(name:.init("terminal-open-research"),object:symbol)}}
    }
    nonisolated func userNotificationCenter(_ center:UNUserNotificationCenter,willPresent notification:UNNotification)async->UNNotificationPresentationOptions{[.banner,.sound,.list]}
}
#endif
