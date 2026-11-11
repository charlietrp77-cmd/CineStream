# -*- coding: utf-8 -*-
"""
CineStream Kodi Video Addon
Main routing & UI controller.
Direct hardware playback for 4K HDR, Dolby Vision, TrueHD Atmos.
"""
import sys
import urllib.parse
import xbmc
import xbmcgui
import xbmcplugin
import xbmcaddon

from resources.lib.cinestream_api import CineStreamAPI

ADDON = xbmcaddon.Addon()
ADDON_ID = ADDON.getAddonInfo('id')
HANDLE = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else -1
BASE_URL = sys.argv[0] if len(sys.argv) > 0 else 'plugin://plugin.video.cinestream/'

def get_setting(key):
    return ADDON.getSetting(key)

def build_url(params):
    return f"{BASE_URL}?{urllib.parse.urlencode(params)}"

def get_api():
    server_url = get_setting('server_url') or 'http://192.168.121.98:3000'
    profile_id = get_setting('profile_id') or ''
    return CineStreamAPI(server_url, profile_id)

def main_menu():
    items = [
        ('🔥 Trending Movies', {'action': 'trending_movies'}, 'DefaultMovies.png'),
        ('📺 Trending TV Series', {'action': 'trending_tv'}, 'DefaultTVShows.png'),
        ('🏆 Top 10 Today', {'action': 'top10'}, 'DefaultVideo.png'),
        ('✨ New Releases (Non-CAM)', {'action': 'new_releases'}, 'DefaultVideo.png'),
        ('🔍 Search Movies & TV', {'action': 'search_prompt'}, 'DefaultAddonsSearch.png'),
        ('⚙️ Server Settings', {'action': 'settings'}, 'DefaultAddonProgram.png'),
    ]

    list_items = []
    for label, params, icon in items:
        li = xbmcgui.ListItem(label=label)
        li.setArt({'icon': icon, 'thumb': icon})
        url = build_url(params)
        list_items.append((url, li, True))

    xbmcplugin.addDirectoryItems(HANDLE, list_items, len(list_items))
    xbmcplugin.setContent(HANDLE, 'files')
    xbmcplugin.endOfDirectory(HANDLE)

def render_movie_catalog(movies, content_title="Movies"):
    list_items = []
    for item in movies:
        title = item.get('title') or item.get('name') or 'Untitled'
        tmdb_id = item.get('tmdbId') or item.get('id')
        imdb_id = item.get('imdbId') or ''
        year = item.get('releaseDate', '')[:4] if item.get('releaseDate') else ''
        plot = item.get('overview') or ''
        poster = item.get('poster') or ''
        backdrop = item.get('backdrop') or ''
        rating = float(item.get('voteAverage') or 0.0)

        quality_badge = item.get('qualityBadge') or ''
        display_label = f"{title} ({year})" if year else title
        if quality_badge:
            display_label += f" [COLOR gold]{quality_badge}[/COLOR]"

        li = xbmcgui.ListItem(label=display_label)
        info_tag = li.getVideoInfoTag()
        info_tag.setTitle(title)
        info_tag.setPlot(plot)
        info_tag.setMediaType('movie')
        if year:
            try:
                info_tag.setYear(int(year))
            except ValueError:
                pass
        if rating > 0:
            info_tag.setRating(rating)

        li.setArt({
            'poster': poster,
            'thumb': poster,
            'fanart': backdrop,
            'icon': poster
        })
        li.setProperty('IsPlayable', 'false')

        url = build_url({
            'action': 'select_movie_stream',
            'tmdb_id': str(tmdb_id),
            'imdb_id': str(imdb_id),
            'title': title
        })
        list_items.append((url, li, True))

    xbmcplugin.addDirectoryItems(HANDLE, list_items, len(list_items))
    xbmcplugin.setContent(HANDLE, 'movies')
    xbmcplugin.endOfDirectory(HANDLE)

def render_tv_catalog(shows):
    list_items = []
    for item in shows:
        title = item.get('name') or item.get('title') or 'Untitled'
        tmdb_id = item.get('tmdbId') or item.get('id')
        imdb_id = item.get('imdbId') or ''
        year = item.get('firstAirDate', '')[:4] if item.get('firstAirDate') else ''
        plot = item.get('overview') or ''
        poster = item.get('poster') or ''
        backdrop = item.get('backdrop') or ''
        rating = float(item.get('voteAverage') or 0.0)

        display_label = f"{title} ({year})" if year else title

        li = xbmcgui.ListItem(label=display_label)
        info_tag = li.getVideoInfoTag()
        info_tag.setTitle(title)
        info_tag.setPlot(plot)
        info_tag.setMediaType('tvshow')
        if year:
            try:
                info_tag.setYear(int(year))
            except ValueError:
                pass
        if rating > 0:
            info_tag.setRating(rating)

        li.setArt({
            'poster': poster,
            'thumb': poster,
            'fanart': backdrop,
            'icon': poster
        })

        url = build_url({
            'action': 'list_seasons',
            'tmdb_id': str(tmdb_id),
            'imdb_id': str(imdb_id),
            'title': title,
            'poster': poster,
            'backdrop': backdrop
        })
        list_items.append((url, li, True))

    xbmcplugin.addDirectoryItems(HANDLE, list_items, len(list_items))
    xbmcplugin.setContent(HANDLE, 'tvshows')
    xbmcplugin.endOfDirectory(HANDLE)

def list_seasons(params):
    tmdb_id = params.get('tmdb_id')
    imdb_id = params.get('imdb_id', '')
    title = params.get('title', '')
    poster = params.get('poster', '')
    backdrop = params.get('backdrop', '')

    api = get_api()
    details = api.get_series_details(tmdb_id)
    seasons = details.get('seasons', []) if details else []

    list_items = []
    for s in seasons:
        season_num = s.get('season_number', 0)
        if season_num == 0:
            continue  # Skip specials

        s_name = s.get('name') or f"Season {season_num}"
        ep_count = s.get('episode_count', 0)
        s_poster = f"https://image.tmdb.org/t/p/w500{s.get('poster_path')}" if s.get('poster_path') else poster

        li = xbmcgui.ListItem(label=f"{s_name} ({ep_count} Episodes)")
        info_tag = li.getVideoInfoTag()
        info_tag.setTitle(s_name)
        info_tag.setMediaType('season')
        info_tag.setSeason(season_num)

        li.setArt({
            'poster': s_poster,
            'thumb': s_poster,
            'fanart': backdrop
        })

        url = build_url({
            'action': 'list_episodes',
            'tmdb_id': str(tmdb_id),
            'imdb_id': str(imdb_id),
            'season': str(season_num),
            'series_title': title,
            'backdrop': backdrop
        })
        list_items.append((url, li, True))

    xbmcplugin.addDirectoryItems(HANDLE, list_items, len(list_items))
    xbmcplugin.setContent(HANDLE, 'seasons')
    xbmcplugin.endOfDirectory(HANDLE)

def list_episodes(params):
    tmdb_id = params.get('tmdb_id')
    imdb_id = params.get('imdb_id', '')
    season_num = params.get('season')
    series_title = params.get('series_title', '')
    backdrop = params.get('backdrop', '')

    api = get_api()
    episodes = api.get_season_episodes(tmdb_id, season_num, imdb_id)

    list_items = []
    for ep in episodes:
        ep_num = ep.get('episode_number') or ep.get('episodeNumber') or 1
        ep_name = ep.get('name') or ep.get('title') or f"Episode {ep_num}"
        plot = ep.get('overview') or ''
        still = ep.get('still') or ep.get('stillPath') or ''

        label = f"{ep_num}. {ep_name}"
        li = xbmcgui.ListItem(label=label)
        info_tag = li.getVideoInfoTag()
        info_tag.setTitle(ep_name)
        info_tag.setTvShowTitle(series_title)
        info_tag.setSeason(int(season_num))
        info_tag.setEpisode(int(ep_num))
        info_tag.setPlot(plot)
        info_tag.setMediaType('episode')

        li.setArt({
            'thumb': still,
            'fanart': backdrop,
            'icon': still
        })
        li.setProperty('IsPlayable', 'false')

        url = build_url({
            'action': 'select_episode_stream',
            'tmdb_id': str(tmdb_id),
            'imdb_id': str(imdb_id),
            'season': str(season_num),
            'episode': str(ep_num),
            'title': f"{series_title} S{int(season_num):02d}E{int(ep_num):02d}"
        })
        list_items.append((url, li, True))

    xbmcplugin.addDirectoryItems(HANDLE, list_items, len(list_items))
    xbmcplugin.setContent(HANDLE, 'episodes')
    xbmcplugin.endOfDirectory(HANDLE)

def handle_stream_playback(media_type, imdb_id, title, season=None, episode=None):
    dialog = xbmcgui.DialogProgress()
    dialog.create("CineStream", f"Resolving streams for {title}...")
    dialog.update(25, "Searching Easynews, Debrid, and Local NAS...")

    api = get_api()
    streams = api.get_streams(media_type, imdb_id, season, episode)
    dialog.update(85, "Filtering playable streams...")

    # Filter out NZB index files (only playable video streams: Easynews, Debrid, NAS Cache)
    playable_streams = []
    for s in streams:
        if s.get('isDirectStream') is False:
            continue
        badges = s.get('badges', {})
        if badges.get('source') in ('AltHub', 'NZBGeek', 'DrunkenSlug') and not badges.get('isNasCached'):
            continue
        playable_streams.append(s)

    dialog.close()

    if not playable_streams:
        xbmcgui.Dialog().notification("CineStream", "No active streams found for this release.", xbmcgui.NOTIFICATION_WARNING, 5000)
        return

    stream_mode = int(get_setting('stream_select_mode') or '1')
    selected_stream = None

    if stream_mode == 0:
        # Auto-play highest scored stream
        selected_stream = playable_streams[0]
    else:
        # Show stream selection dialog with rich badges
        labels = []
        for s in playable_streams:
            badges = s.get('badges', {})
            res = badges.get('resolution', 'HD')
            source = badges.get('source', 'Stream')
            size = badges.get('sizeText', '')

            tags = []
            if badges.get('dolbyVision'):
                tags.append("[COLOR purple]DV[/COLOR]")
            elif badges.get('hdr'):
                tags.append("[COLOR orange]HDR[/COLOR]")
            if badges.get('atmos'):
                tags.append("[COLOR cyan]Atmos[/COLOR]")
            if badges.get('remux'):
                tags.append("[COLOR magenta]Remux[/COLOR]")
            if badges.get('isNasCached'):
                tags.append("[COLOR gold]⚡ Local Gigabit[/COLOR]")

            tag_str = " ".join(tags)
            size_str = f" • {size}" if size else ""
            res_str = f"[B][COLOR white]{res}[/COLOR][/B]"
            source_str = f"[COLOR lime]{source}[/COLOR]"

            label = f"{res_str} {tag_str} {size_str} ({source_str})"
            labels.append(label)

        idx = xbmcgui.Dialog().select(f"CineStream - Select Release ({title})", labels)
        if idx < 0:
            return
        selected_stream = playable_streams[idx]

    # Resolve playback URL
    server_url = get_setting('server_url') or 'http://192.168.121.98:3000'
    stream_url = selected_stream.get('url', '')

    if stream_url.startswith('/'):
        playback_url = f"{server_url.rstrip('/')}{stream_url}"
    else:
        playback_url = stream_url

    # Start native playback in Kodi
    play_item = xbmcgui.ListItem(path=playback_url)
    play_item.setInfo('video', {'Title': title})
    play_item.setProperty('IsPlayable', 'true')

    # Pass custom headers if present
    headers = selected_stream.get('headers')
    if headers and isinstance(headers, dict):
        header_str = "|".join([f"{k}={v}" for k, v in headers.items()])
        if '|' in playback_url:
            playback_url += f"&{header_str}"
        else:
            playback_url += f"|{header_str}"
        play_item.setPath(playback_url)

    xbmc.Player().play(playback_url, play_item)

def search_dialog():
    kb = xbmc.Keyboard('', 'Search CineStream Library & Providers')
    kb.doModal()
    if kb.isConfirmed() and kb.getText().strip():
        query = kb.getText().strip()
        api = get_api()
        results = api.search(query)
        if not results:
            xbmcgui.Dialog().notification("CineStream", f"No results for '{query}'", xbmcgui.NOTIFICATION_INFO, 4000)
            return

        movies = [r for r in results if r.get('type') == 'movie']
        shows = [r for r in results if r.get('type') == 'tv']

        # Render combined list
        render_movie_catalog(movies + shows, f"Search: {query}")

def router(paramstring):
    params = dict(urllib.parse.parse_qsl(paramstring.lstrip('?')))
    action = params.get('action')

    api = get_api()

    if not action:
        main_menu()
    elif action == 'trending_movies':
        render_movie_catalog(api.get_trending_movies(), "Trending Movies")
    elif action == 'trending_tv':
        render_tv_catalog(api.get_trending_tv())
    elif action == 'top10':
        render_movie_catalog(api.get_top10(), "Top 10")
    elif action == 'new_releases':
        render_movie_catalog(api.get_new_releases(), "New Releases")
    elif action == 'search_prompt':
        search_dialog()
    elif action == 'list_seasons':
        list_seasons(params)
    elif action == 'list_episodes':
        list_episodes(params)
    elif action == 'select_movie_stream':
        handle_stream_playback('movie', params.get('imdb_id') or params.get('tmdb_id'), params.get('title', 'Movie'))
    elif action == 'select_episode_stream':
        handle_stream_playback(
            'series',
            params.get('imdb_id') or params.get('tmdb_id'),
            params.get('title', 'Episode'),
            params.get('season'),
            params.get('episode')
        )
    elif action == 'settings':
        ADDON.openSettings()

if __name__ == '__main__':
    router(sys.argv[2] if len(sys.argv) > 2 else '')
