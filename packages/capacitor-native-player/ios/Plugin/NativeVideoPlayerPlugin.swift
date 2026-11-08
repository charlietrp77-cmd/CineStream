import Foundation
import Capacitor
import AVFoundation
import UIKit

@objc(NativeVideoPlayerPlugin)
public class NativeVideoPlayerPlugin: CAPPlugin, URLSessionDownloadDelegate {

    private var avPlayer: AVPlayer?
    private var avPlayerLayer: AVPlayerLayer?
    private var videoContainerView: UIView?
    private var timeObserverToken: Any?
    private var downloadSession: URLSession?
    private var downloadTasks = [Int: String]() // taskIdentifier -> downloadId
    private var downloadProgressMap = [String: (bytes: Int64, total: Int64, lastSample: Int64, lastTime: Date)]()

    public override func load() {
        super.load()
        let config = URLSessionConfiguration.background(withIdentifier: "com.cinestream.offline.downloader")
        downloadSession = URLSession(configuration: config, delegate: self, delegateQueue: OperationQueue.main)
    }

    @objc func loadAndPlay(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Valid url is required")
            return
        }

        let startPositionMs = call.getInt("startPositionMs") ?? 0

        DispatchQueue.main.async { [weak self] in
            guard let self = self, let bridge = self.bridge, let webView = bridge.webView else {
                call.reject("Bridge not ready")
                return
            }

            // Transparent WebView Sandwich
            webView.isOpaque = false
            webView.backgroundColor = .clear
            webView.scrollView.backgroundColor = .clear

            if self.videoContainerView == nil {
                let container = UIView(frame: webView.bounds)
                container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                container.backgroundColor = .black
                webView.superview?.insertSubview(container, belowSubview: webView)
                self.videoContainerView = container
            }

            self.stopInternal()

            let playerItem = AVPlayerItem(url: url)
            let player = AVPlayer(playerItem: playerItem)
            self.avPlayer = player

            let layer = AVPlayerLayer(player: player)
            layer.frame = self.videoContainerView!.bounds
            layer.videoGravity = .resizeAspect
            self.videoContainerView!.layer.sublayers?.forEach { $0.removeFromSuperlayer() }
            self.videoContainerView!.layer.addSublayer(layer)
            self.avPlayerLayer = layer

            if startPositionMs > 0 {
                let targetTime = CMTime(value: CMTimeValue(startPositionMs), timescale: 1000)
                player.seek(to: targetTime, toleranceBefore: .zero, toleranceAfter: .zero)
            }

            player.play()
            self.notifyListeners("stateChange", data: ["state": "playing"])

            let interval = CMTime(value: 1, timescale: 1)
            self.timeObserverToken = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
                guard let self = self, let currentItem = self.avPlayer?.currentItem else { return }
                let currentMs = Int(CMTimeGetSeconds(time) * 1000)
                let durationMs = Int(CMTimeGetSeconds(currentItem.duration) * 1000)

                self.notifyListeners("timeUpdate", data: [
                    "currentTimeMs": currentMs,
                    "durationMs": durationMs > 0 ? durationMs : 0
                ])
            }

            NotificationCenter.default.addObserver(
                self,
                selector: #selector(self.playerDidFinishPlaying),
                name: .AVPlayerItemDidPlayToEndTime,
                object: playerItem
            )

            call.resolve()
        }
    }

    @objc func playerDidFinishPlaying() {
        notifyListeners("playbackEnded", data: [:])
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.avPlayer?.pause()
            self?.notifyListeners("stateChange", data: ["state": "paused"])
            call.resolve()
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.avPlayer?.play()
            self?.notifyListeners("stateChange", data: ["state": "playing"])
            call.resolve()
        }
    }

    @objc func seekTo(_ call: CAPPluginCall) {
        let positionMs = call.getInt("positionMs") ?? 0
        DispatchQueue.main.async { [weak self] in
            let time = CMTime(value: CMTimeValue(positionMs), timescale: 1000)
            self?.avPlayer?.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.stopInternal()
            self?.videoContainerView?.removeFromSuperview()
            self?.videoContainerView = nil
            self?.bridge?.webView?.backgroundColor = UIColor(red: 10/255, green: 10/255, blue: 10/255, alpha: 1.0)
            call.resolve()
        }
    }

    private func stopInternal() {
        if let token = timeObserverToken {
            avPlayer?.removeTimeObserver(token)
            timeObserverToken = nil
        }
        avPlayer?.pause()
        avPlayer = nil
        avPlayerLayer?.removeFromSuperlayer()
        avPlayerLayer = nil
    }

    @objc func getTracks(_ call: CAPPluginCall) {
        call.resolve([
            "audioTracks": [],
            "subtitleTracks": []
        ])
    }

    @objc func setAudioTrack(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func setSubtitleTrack(_ call: CAPPluginCall) {
        call.resolve()
    }

    // Offline Tablet Storage API
    @objc func startOfflineDownload(_ call: CAPPluginCall) {
        guard let downloadId = call.getString("downloadId"),
              let urlString = call.getString("url"),
              let url = URL(string: urlString) else {
            call.reject("downloadId and url are required")
            return
        }

        let task = downloadSession?.downloadTask(with: url)
        if let t = task {
            downloadTasks[t.taskIdentifier] = downloadId
            downloadProgressMap[downloadId] = (bytes: 0, total: 0, lastSample: 0, lastTime: Date())
            t.resume()

            let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
            let offlineDir = paths[0].appendingPathComponent("OfflineMedia")
            let localUrl = offlineDir.appendingPathComponent(call.getString("filename") ?? "\(downloadId).mkv")
            call.resolve(["localFileUri": localUrl.absoluteString])
        } else {
            call.reject("Could not create download task")
        }
    }

    @objc func pauseOfflineDownload(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func resumeOfflineDownload(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func removeOfflineDownload(_ call: CAPPluginCall) {
        if let uri = call.getString("localFileUri"), let url = URL(string: uri) {
            try? FileManager.default.removeItem(at: url)
        }
        call.resolve()
    }

    @objc func getDeviceStorageInfo(_ call: CAPPluginCall) {
        let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
        if let dict = try? FileManager.default.attributesOfFileSystem(forPath: paths[0].path) {
            let total = (dict[.systemSize] as? NSNumber)?.int64Value ?? 0
            let free = (dict[.systemFreeSize] as? NSNumber)?.int64Value ?? 0
            call.resolve([
                "totalBytes": total,
                "freeBytes": free
            ])
            return
        }
        call.resolve([
            "totalBytes": 128 * 1024 * 1024 * 1024,
            "freeBytes": 64 * 1024 * 1024 * 1024
        ])
    }

    // URLSessionDownloadDelegate
    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let downloadId = downloadTasks[downloadTask.taskIdentifier] else { return }

        let now = Date()
        var current = downloadProgressMap[downloadId] ?? (bytes: 0, total: 0, lastSample: 0, lastTime: now)
        let elapsed = now.timeIntervalSince(current.lastTime)

        if elapsed >= 1.0 {
            let speed = Int64(Double(totalBytesWritten - current.lastSample) / elapsed)
            current.lastSample = totalBytesWritten
            current.lastTime = now
            downloadProgressMap[downloadId] = current

            notifyListeners("offlineDownloadProgress", data: [
                "downloadId": downloadId,
                "bytesDownloaded": totalBytesWritten,
                "totalBytes": totalBytesExpectedToWrite,
                "speedBytesPerSec": max(0, speed),
                "status": "downloading"
            ])
        }
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let downloadId = downloadTasks[downloadTask.taskIdentifier] else { return }

        let fileManager = FileManager.default
        let paths = fileManager.urls(for: .documentDirectory, in: .userDomainMask)
        let offlineDir = paths[0].appendingPathComponent("OfflineMedia")

        try? fileManager.createDirectory(at: offlineDir, withIntermediateDirectories: true)
        var targetUrl = offlineDir.appendingPathComponent("\(downloadId).mkv")

        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try? targetUrl.setResourceValues(resourceValues)

        try? fileManager.removeItem(at: targetUrl)
        try? fileManager.moveItem(at: location, to: targetUrl)

        notifyListeners("offlineDownloadProgress", data: [
            "downloadId": downloadId,
            "bytesDownloaded": downloadTask.countOfBytesReceived,
            "totalBytes": downloadTask.countOfBytesReceived,
            "speedBytesPerSec": 0,
            "status": "completed",
            "localFileUri": targetUrl.absoluteString
        ])

        downloadTasks.removeValue(forKey: downloadTask.taskIdentifier)
        downloadProgressMap.removeValue(forKey: downloadId)
    }
}

