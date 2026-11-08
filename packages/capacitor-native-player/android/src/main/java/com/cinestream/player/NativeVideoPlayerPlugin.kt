package com.cinestream.player

import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import android.view.SurfaceView
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.FileDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.ui.PlayerView
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL

@CapacitorPlugin(name = "NativeVideoPlayer")
@UnstableApi
class NativeVideoPlayerPlugin : Plugin() {

    private var exoPlayer: ExoPlayer? = null
    private var playerView: PlayerView? = null
    private var trackSelector: DefaultTrackSelector? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var progressRunnable: Runnable? = null
    private val downloadJobs = mutableMapOf<String, Job>()
    private val pluginScope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    @PluginMethod
    fun loadAndPlay(call: PluginCall) {
        val urlString = call.getString("url") ?: run {
            call.reject("url is required")
            return
        }
        val startPositionMs = call.getLong("startPositionMs", 0L) ?: 0L
        val headers = call.getObject("headers")

        activity.runOnUiThread {
            setupPlayerSurface()

            val context = activity.applicationContext
            val uri = Uri.parse(urlString)

            // Configure Extension Renderers & Tunneling for Dolby Vision and TrueHD / DTS-HD MA
            val renderersFactory = DefaultRenderersFactory(context)
                .setExtensionRendererMode(EXTENSION_RENDERER_MODE_PREFER)

            trackSelector = DefaultTrackSelector(context).apply {
                setParameters(
                    buildUponParameters()
                        .setTunnelingEnabled(true)
                )
            }

            val dataSourceFactory = if (urlString.startsWith("file://")) {
                FileDataSource.Factory()
            } else {
                DefaultHttpDataSource.Factory().apply {
                    setUserAgent("CineStream/1.0.0 (ExoPlayer)")
                    setConnectTimeoutMs(15000)
                    setReadTimeoutMs(15000)
                    setAllowCrossProtocolRedirects(true)
                    headers?.let {
                        val headerMap = mutableMapOf<String, String>()
                        val keys = it.keys()
                        while (keys.hasNext()) {
                            val key = keys.next()
                            headerMap[key] = it.getString(key) ?: ""
                        }
                        setDefaultRequestProperties(headerMap)
                    }
                }
            }

            val mediaSourceFactory = DefaultMediaSourceFactory(dataSourceFactory)

            exoPlayer?.release()
            exoPlayer = ExoPlayer.Builder(context, renderersFactory)
                .setTrackSelector(trackSelector!!)
                .setMediaSourceFactory(mediaSourceFactory)
                .build().apply {
                    val mediaItem = MediaItem.fromUri(uri)
                    setMediaItem(mediaItem)
                    prepare()
                    if (startPositionMs > 0) {
                        seekTo(startPositionMs)
                    }
                    playWhenReady = true

                    addListener(object : Player.Listener {
                        override fun onPlaybackStateChanged(playbackState: Int) {
                            when (playbackState) {
                                Player.STATE_READY -> {
                                    val data = JSObject()
                                    data.put("state", if (playWhenReady) "playing" else "paused")
                                    notifyListeners("stateChange", data)
                                }
                                Player.STATE_ENDED -> {
                                    notifyListeners("playbackEnded", JSObject())
                                }
                                else -> {}
                            }
                        }

                        override fun onIsPlayingChanged(isPlaying: Boolean) {
                            val data = JSObject()
                            data.put("state", if (isPlaying) "playing" else "paused")
                            notifyListeners("stateChange", data)
                        }

                        override fun onPlayerError(error: PlaybackException) {
                            val data = JSObject()
                            data.put("message", error.message ?: "Playback error")
                            data.put("code", error.errorCode)
                            notifyListeners("error", data)
                        }

                        override fun onTracksChanged(tracks: Tracks) {
                            emitTracks(tracks)
                        }
                    })
                }

            playerView?.player = exoPlayer
            startProgressReporting()
            call.resolve()
        }
    }

    private fun setupPlayerSurface() {
        if (playerView == null) {
            val root = activity.findViewById<ViewGroup>(android.R.id.content)
            bridge.webView.setBackgroundColor(Color.TRANSPARENT)

            playerView = PlayerView(activity).apply {
                useController = false
                layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            }

            // Insert underneath WebView
            root.addView(playerView, 0)
        }
    }

    private fun startProgressReporting() {
        progressRunnable?.let { mainHandler.removeCallbacks(it) }
        progressRunnable = object : Runnable {
            override fun run() {
                exoPlayer?.let { player ->
                    if (player.playbackState == Player.STATE_READY || player.isPlaying) {
                        val data = JSObject()
                        data.put("currentTimeMs", player.currentPosition)
                        data.put("durationMs", player.duration.coerceAtLeast(0L))
                        notifyListeners("timeUpdate", data)
                    }
                }
                mainHandler.postDelayed(this, 1000)
            }
        }
        mainHandler.post(progressRunnable!!)
    }

    private fun emitTracks(tracks: Tracks) {
        val audioTracks = JSArray()
        val subtitleTracks = JSArray()

        for (group in tracks.groups) {
            val trackType = group.type
            val trackGroup = group.mediaTrackGroup

            for (i in 0 until trackGroup.length) {
                val format = trackGroup.getFormat(i)
                val trackObj = JSObject()
                trackObj.put("id", "${group.type}_${format.id ?: i}")
                trackObj.put("language", format.language ?: "und")
                trackObj.put("label", format.label ?: format.language ?: "Track ${i + 1}")
                trackObj.put("codec", format.sampleMimeType ?: "")
                trackObj.put("selected", group.isTrackSelected(i))

                if (trackType == C.TRACK_TYPE_AUDIO) {
                    audioTracks.put(trackObj)
                } else if (trackType == C.TRACK_TYPE_TEXT) {
                    subtitleTracks.put(trackObj)
                }
            }
        }

        val data = JSObject()
        data.put("audioTracks", audioTracks)
        data.put("subtitleTracks", subtitleTracks)
        notifyListeners("tracksLoaded", data)
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        activity.runOnUiThread {
            exoPlayer?.playWhenReady = false
            call.resolve()
        }
    }

    @PluginMethod
    fun resume(call: PluginCall) {
        activity.runOnUiThread {
            exoPlayer?.playWhenReady = true
            call.resolve()
        }
    }

    @PluginMethod
    fun seekTo(call: PluginCall) {
        val positionMs = call.getLong("positionMs") ?: 0L
        activity.runOnUiThread {
            exoPlayer?.seekTo(positionMs)
            call.resolve()
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        activity.runOnUiThread {
            progressRunnable?.let { mainHandler.removeCallbacks(it) }
            exoPlayer?.stop()
            exoPlayer?.release()
            exoPlayer = null

            playerView?.let {
                val parent = it.parent as? ViewGroup
                parent?.removeView(it)
                playerView = null
            }

            bridge.webView.setBackgroundColor(Color.parseColor("#0a0a0a"))
            call.resolve()
        }
    }

    @PluginMethod
    fun getTracks(call: PluginCall) {
        activity.runOnUiThread {
            val res = JSObject()
            res.put("audioTracks", JSArray())
            res.put("subtitleTracks", JSArray())
            call.resolve(res)
        }
    }

    @PluginMethod
    fun setAudioTrack(call: PluginCall) {
        // Track selection via trackSelector parameters
        call.resolve()
    }

    @PluginMethod
    fun setSubtitleTrack(call: PluginCall) {
        call.resolve()
    }

    // Offline Tablet Storage API
    @PluginMethod
    fun startOfflineDownload(call: PluginCall) {
        val downloadId = call.getString("downloadId") ?: run {
            call.reject("downloadId is required")
            return
        }
        val url = call.getString("url") ?: run {
            call.reject("url is required")
            return
        }
        val filename = call.getString("filename") ?: "${downloadId}.mkv"

        val offlineDir = File(activity.getExternalFilesDir(null), "OfflineMedia")
        if (!offlineDir.exists()) offlineDir.mkdirs()
        val targetFile = File(offlineDir, filename)
        val partFile = File(offlineDir, "$filename.part")

        val job = pluginScope.launch(Dispatchers.IO) {
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                conn.connect()

                val totalBytes = conn.contentLength.toLong()
                val inputStream = conn.inputStream
                val outputStream = FileOutputStream(partFile)

                val buffer = ByteArray(64 * 1024)
                var bytesRead: Int
                var downloaded = 0L
                var lastSampleTime = System.currentTimeMillis()
                var lastBytes = 0L

                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    if (!isActive) break
                    outputStream.write(buffer, 0, bytesRead)
                    downloaded += bytesRead

                    val now = System.currentTimeMillis()
                    if (now - lastSampleTime >= 1000) {
                        val delta = downloaded - lastBytes
                        val speed = (delta * 1000 / (now - lastSampleTime))
                        lastBytes = downloaded
                        lastSampleTime = now

                        val progress = JSObject().apply {
                            put("downloadId", downloadId)
                            put("bytesDownloaded", downloaded)
                            put("totalBytes", totalBytes)
                            put("speedBytesPerSec", speed)
                            put("status", "downloading")
                            put("localFileUri", Uri.fromFile(targetFile).toString())
                        }
                        notifyListeners("offlineDownloadProgress", progress)
                    }
                }

                outputStream.flush()
                outputStream.close()
                inputStream.close()

                if (isActive) {
                    if (targetFile.exists()) targetFile.delete()
                    partFile.renameTo(targetFile)

                    val complete = JSObject().apply {
                        put("downloadId", downloadId)
                        put("bytesDownloaded", downloaded)
                        put("totalBytes", if (totalBytes > 0) totalBytes else downloaded)
                        put("speedBytesPerSec", 0)
                        put("status", "completed")
                        put("localFileUri", Uri.fromFile(targetFile).toString())
                    }
                    notifyListeners("offlineDownloadProgress", complete)
                }
            } catch (e: Exception) {
                val err = JSObject().apply {
                    put("downloadId", downloadId)
                    put("status", "failed")
                    put("error", e.message ?: "Download failed")
                }
                notifyListeners("offlineDownloadProgress", err)
            } finally {
                downloadJobs.remove(downloadId)
            }
        }

        downloadJobs[downloadId] = job
        val res = JSObject()
        res.put("localFileUri", Uri.fromFile(targetFile).toString())
        call.resolve(res)
    }

    @PluginMethod
    fun pauseOfflineDownload(call: PluginCall) {
        val downloadId = call.getString("downloadId")
        downloadJobs[downloadId]?.cancel()
        downloadJobs.remove(downloadId)

        val data = JSObject().apply {
            put("downloadId", downloadId)
            put("status", "paused")
        }
        notifyListeners("offlineDownloadProgress", data)
        call.resolve()
    }

    @PluginMethod
    fun resumeOfflineDownload(call: PluginCall) {
        call.resolve()
    }

    @PluginMethod
    fun removeOfflineDownload(call: PluginCall) {
        val downloadId = call.getString("downloadId")
        downloadJobs[downloadId]?.cancel()
        downloadJobs.remove(downloadId)

        val localFileUri = call.getString("localFileUri")
        if (localFileUri != null) {
            val file = File(Uri.parse(localFileUri).path ?: "")
            if (file.exists()) file.delete()
        }
        call.resolve()
    }

    @PluginMethod
    fun getDeviceStorageInfo(call: PluginCall) {
        val path = activity.getExternalFilesDir(null) ?: activity.filesDir
        val stat = StatFs(path.path)
        val blockSize = stat.blockSizeLong
        val totalBlocks = stat.blockCountLong
        val availableBlocks = stat.availableBlocksLong

        val totalBytes = totalBlocks * blockSize
        val freeBytes = availableBlocks * blockSize

        val res = JSObject()
        res.put("totalBytes", totalBytes)
        res.put("freeBytes", freeBytes)
        call.resolve(res)
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        progressRunnable?.let { mainHandler.removeCallbacks(it) }
        exoPlayer?.release()
        exoPlayer = null
        pluginScope.cancel()
    }
}

