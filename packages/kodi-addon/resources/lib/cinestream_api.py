# -*- coding: utf-8 -*-
"""
CineStream Fastify API Client
Communicates directly with the self-hosted CineStream server.
Zero external dependencies (uses standard Python 3 urllib).
"""
import json
import urllib.request
import urllib.parse
import urllib.error

class CineStreamAPI:
    def __init__(self, base_url, profile_id=''):
        self.base_url = base_url.rstrip('/')
        self.profile_id = profile_id

    def _get(self, path, params=None, timeout=10):
        url = f"{self.base_url}{path}"
        if params:
            url += f"?{urllib.parse.urlencode(params)}"

        headers = {
            'User-Agent': 'CineStream-Kodi/1.0.0',
            'Accept': 'application/json'
        }
        if self.profile_id:
            headers['X-Profile-Id'] = self.profile_id

        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                if response.status == 200:
                    data = response.read().decode('utf-8')
                    return json.loads(data)
        except Exception as e:
            print(f"[CineStreamAPI] GET {url} failed: {e}")
        return None

    def _post(self, path, payload, timeout=6):
        url = f"{self.base_url}{path}"
        data_bytes = json.dumps(payload).encode('utf-8')
        headers = {
            'User-Agent': 'CineStream-Kodi/1.0.0',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        if self.profile_id:
            headers['X-Profile-Id'] = self.profile_id

        req = urllib.request.Request(url, data=data_bytes, headers=headers, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.status in (200, 204)
        except Exception as e:
            print(f"[CineStreamAPI] POST {url} failed: {e}")
            return False

    def get_trending_movies(self):
        res = self._get('/api/catalog/trending', {'type': 'movie'})
        return res or []

    def get_trending_tv(self):
        res = self._get('/api/catalog/trending', {'type': 'tv'})
        return res or []

    def get_top10(self, media_type='movie'):
        res = self._get('/api/catalog/top10', {'type': media_type})
        return res or []

    def get_new_releases(self):
        res = self._get('/api/catalog/new-releases')
        return res or []

    def search(self, query):
        res = self._get('/api/search', {'q': query})
        return res or []

    def get_series_details(self, tmdb_id):
        res = self._get(f'/api/catalog/series/{tmdb_id}')
        return res

    def get_season_episodes(self, tmdb_id, season_num, imdb_id=''):
        params = {}
        if imdb_id:
            params['imdbId'] = imdb_id
        res = self._get(f'/api/catalog/series/{tmdb_id}/season/{season_num}', params)
        if res and isinstance(res, dict) and 'episodes' in res:
            return res['episodes']
        return []

    def get_streams(self, media_type, imdb_id, season=None, episode=None):
        endpoint_type = 'series' if media_type in ('tv', 'series') else 'movie'
        path = f'/api/streams/{endpoint_type}/{imdb_id}'
        params = {}
        if season is not None and int(season) > 0:
            params['season'] = str(season)
        if episode is not None and int(episode) > 0:
            params['episode'] = str(episode)

        res = self._get(path, params, timeout=14)
        return res or []

    def update_progress(self, imdb_id, tmdb_id, media_type, season, episode, current_time_sec, duration_sec):
        payload = {
            'imdb_id': imdb_id,
            'tmdb_id': int(tmdb_id or 0),
            'media_type': 'tv' if media_type in ('tv', 'series') else 'movie',
            'season': int(season or 0),
            'episode': int(episode or 0),
            'progress_seconds': int(current_time_sec),
            'duration_seconds': int(duration_sec),
            'last_stream_url': ''
        }
        return self._post('/api/progress', payload)
