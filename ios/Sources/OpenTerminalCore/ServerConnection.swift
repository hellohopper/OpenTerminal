import Foundation

public enum ConnectionError: LocalizedError, Equatable, Sendable {
    case invalidServer, invalidPath, unauthorized, offline, unreachable, tls, timedOut, response(Int, String)
    public var errorDescription: String? {
        switch self {
        case .invalidServer: NSLocalizedString("Enter an HTTPS server origin, such as https://terminal.example.com.", comment: "")
        case .invalidPath: NSLocalizedString("Invalid API path.", comment: "")
        case .unauthorized: NSLocalizedString("Your session expired. Sign in again.", comment: "")
        case .offline: NSLocalizedString("No network connection. Connect to Wi-Fi or cellular and enable Tailscale.", comment: "")
        case .unreachable: NSLocalizedString("Cannot reach the Mac. Check Tailscale, the server address and whether the Mac is awake.", comment: "")
        case .tls: NSLocalizedString("The server certificate could not be verified. Use the Mac’s configured HTTPS address.", comment: "")
        case .timedOut: NSLocalizedString("The Mac did not respond in time. Check its connection and retry.", comment: "")
        case let .response(code, message): "\(NSLocalizedString(message, comment: "")) (\(code))"
        }
    }
}

public struct ServerConnection: Equatable, Sendable {
    public let origin: URL
    public init(_ input: String) throws {
        guard var parts = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              parts.scheme == "https" || (parts.scheme == "http" && ["localhost", "127.0.0.1", "[::1]"].contains(host))
        else { throw ConnectionError.invalidServer }
        parts.path = ""
        guard let origin = parts.url else { throw ConnectionError.invalidServer }
        self.origin = origin
    }
    public func url(path: String, query: [String: String] = [:]) throws -> URL {
        guard path.hasPrefix("/api/"), !path.contains(".."), !path.contains("?"), !path.contains("#"), !path.contains("\\") else { throw ConnectionError.invalidPath }
        var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        parts.path = path
        if !query.isEmpty {
            parts.queryItems = query.sorted(by: { $0.key < $1.key }).map { URLQueryItem(name: $0.key, value: $0.value) }
            // The backend's form-style query decoder treats an unescaped '+' as whitespace.
            parts.percentEncodedQuery = parts.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        }
        return parts.url!
    }
    public func researchURL(symbol: String) -> URL {
        var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        parts.path = "/"; parts.queryItems = [URLQueryItem(name: "research", value: symbol)]
        return parts.url!
    }
}

// Do not forward session cookies or sign-in bodies through redirects.
private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

public actor TerminalAPI {
    public let server: ServerConnection
    private let session: URLSession
    private var credential: MobileCredential?
    public init(server: ServerConnection, credential: MobileCredential? = nil, configuration: URLSessionConfiguration = .ephemeral) {
        self.server = server
        self.credential = credential
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 90
        self.session = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }
    public func signIn(password: String) async throws {
        do { let _: Acknowledgement = try await send("/api/session", method: "POST", body: JSONEncoder().encode(["password": password])) }
        catch ConnectionError.unauthorized { throw ConnectionError.response(401, "Invalid password.") }
    }
    public func signOut() async {
        let _: Acknowledgement? = try? await send(credential == nil ? "/api/session" : "/api/mobile/session", method: "DELETE")
        credential = nil
        session.invalidateAndCancel()
    }
    public func pair(password: String, name: String) async throws -> MobileCredential {
        do {
            let value: MobileCredential = try await send("/api/mobile/session", method: "POST", body: JSONEncoder().encode(["password":password,"name":name]))
            credential = value; return value
        } catch ConnectionError.unauthorized { throw ConnectionError.response(401,"Invalid password.") }
    }
    public func renewDevice() async throws -> MobileCredential {
        guard let current = credential else { throw ConnectionError.unauthorized }
        let value: MobileAuthorization = try await send("/api/mobile/session", method: "PUT")
        let next = MobileCredential(id:value.id,name:value.name,token:current.token,expiresAt:value.expiresAt)
        credential=next; return next
    }
    public func delete(_ path: String, query: [String: String] = [:]) async throws { let _: Acknowledgement = try await send(path, query: query, method:"DELETE") }
    public func get<T: Decodable & Sendable>(_ path: String, query: [String: String] = [:], as: T.Type = T.self) async throws -> T {
        try await send(path, query: query)
    }
    public func post<B: Encodable & Sendable, T: Decodable & Sendable>(_ path: String, body: B, as: T.Type = T.self) async throws -> T {
        try await send(path, method: "POST", body: JSONEncoder().encode(body))
    }
    public func put<B: Encodable & Sendable, T: Decodable & Sendable>(_ path: String, body: B, as: T.Type = T.self) async throws -> T {
        try await send(path, method: "PUT", body: JSONEncoder().encode(body))
    }
    public func setAlertArmed(id: Int, armed: Bool) async throws {
        let _: Acknowledgement = try await send("/api/alerts/\(id)", method: "PUT", body: JSONEncoder().encode(["armed": armed]))
    }
    private func send<T: Decodable & Sendable>(_ path: String, query: [String: String] = [:], method: String = "GET", body: Data? = nil) async throws -> T {
        var request = URLRequest(url: try server.url(path: path, query: query))
        request.httpMethod = method; request.httpBody = body
        request.setValue(server.origin.absoluteString, forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let credential { request.setValue("Bearer \(credential.token)", forHTTPHeaderField:"Authorization") }
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let data: Data, response: URLResponse
        do { (data,response) = try await session.data(for: request) }
        catch let error as URLError {
            switch error.code {
            case .notConnectedToInternet, .networkConnectionLost: throw ConnectionError.offline
            case .timedOut: throw ConnectionError.timedOut
            case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid: throw ConnectionError.tls
            case .cancelled: throw CancellationError()
            default: throw ConnectionError.unreachable
            }
        }
        guard let http = response as? HTTPURLResponse else { throw ConnectionError.response(0, "Invalid server response.") }
        if http.statusCode == 401 { throw ConnectionError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ServerError.self, from: data))?.error ?? "The request could not be completed."
            throw ConnectionError.response(http.statusCode, message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
private struct ServerError: Decodable { let error: String }
public struct Acknowledgement: Decodable, Sendable {}
