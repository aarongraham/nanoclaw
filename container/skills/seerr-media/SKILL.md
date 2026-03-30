---
name: seerr-media
description: Search for and request movies and TV shows via Seerr. Requests are sent to Sonarr/Radarr for downloading and automatically appear in Plex when ready. Use when someone asks to download, request, or find a movie or TV show.
---

# Seerr Media Requests

Request movies and TV shows. Seerr sends requests to Sonarr (TV) / Radarr (movies) for downloading. Plex is notified automatically when media is ready.

## Connection

- **URL**: `http://192.168.42.11:5055`
- **Auth**: `X-Api-Key` header

```bash
SEERR_URL="http://192.168.42.11:5055"
SEERR_KEY="MTc3NDMxODM2ODc1MzA0NzBlNTcyLTAyZGUtNGJlYi05OTNkLTY3OGIzNmYyNTU5Yw=="
```

## Search for media

```bash
curl -s "$SEERR_URL/api/v1/search?query=SEARCH_TERM&page=1&language=en" \
  -H "X-Api-Key: $SEERR_KEY"
```

Returns results with `mediaType` ("movie" or "tv"), `id` (TMDB ID), `title` (movies) or `name` (TV), and `releaseDate` or `firstAirDate`.

## Request a movie

```bash
curl -s -X POST "$SEERR_URL/api/v1/request" \
  -H "X-Api-Key: $SEERR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mediaType": "movie", "mediaId": TMDB_ID}'
```

## Request a TV show

All seasons:
```bash
curl -s -X POST "$SEERR_URL/api/v1/request" \
  -H "X-Api-Key: $SEERR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mediaType": "tv", "mediaId": TMDB_ID, "seasons": "all"}'
```

Specific seasons:
```bash
curl -s -X POST "$SEERR_URL/api/v1/request" \
  -H "X-Api-Key: $SEERR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mediaType": "tv", "mediaId": TMDB_ID, "seasons": [1, 2]}'
```

## Check request status

```bash
curl -s "$SEERR_URL/api/v1/request?take=20" -H "X-Api-Key: $SEERR_KEY"
```

Status codes: 1=pending, 2=approved, 3=declined, 4=processing, 5=available.

## Get details for a specific title

```bash
# Movie
curl -s "$SEERR_URL/api/v1/movie/TMDB_ID" -H "X-Api-Key: $SEERR_KEY"

# TV show
curl -s "$SEERR_URL/api/v1/tv/TMDB_ID" -H "X-Api-Key: $SEERR_KEY"
```

## Typical workflow

1. Search for the title → get the TMDB ID
2. Check if already requested/available via the detail endpoint (look for `mediaInfo.status`)
3. If not available, POST a request with the TMDB ID
4. Tell the user it's been requested — downloads happen in the background (minutes to hours) and Plex picks it up automatically

## Response style

- Confirm what you found and what you're requesting before submitting
- If the search returns multiple results, ask which one they mean
- After requesting, let them know it'll appear in Plex once downloaded
