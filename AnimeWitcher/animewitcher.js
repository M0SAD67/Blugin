const animewitcher = {
  baseUrl: 'https://animewitcher.com',
  algoliaAppId: '5UIU27G8CZ',
  algoliaApiKey: 'ef06c5ee4a0d213c011694f18861805c',
  firebaseProjectId: 'animewitcher-1c66d',

  getInfo: async function() {
    return {
      id: 'animewitcher',
      name: 'AnimeWitcher (JS)',
      version: '1.0.4',
      author: 'M O S A',
      description: 'مصدر أنمي ويتشر لمشاهدة الأنمي المترجم',
      icon: 'https://raw.githubusercontent.com/M0SAD67/Blugin/refs/heads/main/AnimeWitcher/icon.png',
      language: 'ar',
      is_arabic: true,
      is_anime: true,
      is_movie: false,
      is_series: false,
      is_download_supported: true,
      nsfw: false
    };
  },

  _firestoreUrl: function(path) {
    return `https://firestore.googleapis.com/v1/projects/${this.firebaseProjectId}/databases/(default)/documents/${path}`;
  },

  _algoliaHeaders: function() {
    return {
      'X-Algolia-Application-Id': this.algoliaAppId,
      'X-Algolia-API-Key': this.algoliaApiKey,
      'Content-Type': 'application/json; charset=UTF-8',
      'User-Agent': 'Algolia for Android (3.27.0); Android (13)',
    };
  },

  _algoliaQueryUrl: function(index) {
    return `https://${this.algoliaAppId}-dsn.algolia.net/1/indexes/${index}/query`;
  },

  _refreshAlgoliaKeys: async function() {
    try {
      const url = this._firestoreUrl('Settings');
      const response = await AppBridge.request(url, { method: 'GET' });
      const data = JSON.parse(response);
      const documents = data.documents;
      if (!documents) return;

      for (const doc of documents) {
        const fields = doc.fields || {};
        if (fields.search_settings) {
          const searchSettings = fields.search_settings.mapValue.fields;
          if (searchSettings) {
            const newAppId = searchSettings.app_id_v3.stringValue;
            const newApiKey = searchSettings.api_key.stringValue;
            if (newAppId && newApiKey) {
              this.algoliaAppId = newAppId;
              this.algoliaApiKey = newApiKey;
            }
          }
        }
      }
    } catch (e) {
      console.log('Algolia refresh failed: ' + e);
    }
  },

  search: async function(query) {
    try {
      await this._refreshAlgoliaKeys();

      const attributes = JSON.stringify([
        "objectID",
        "name",
        "poster_uri",
        "type",
        "details",
        "tags",
        "story",
        "english_title",
        "_highlightResult",
      ]);

      const params = `attributesToRetrieve=${encodeURIComponent(attributes)}&hitsPerPage=50&page=0&query=${encodeURIComponent(query)}`;

      const response = await AppBridge.post(this._algoliaQueryUrl('series'), 
        JSON.stringify({ params: params }),
        this._algoliaHeaders()
      );

      let data;
      try {
        data = typeof response === 'string' ? JSON.parse(response) : response;
        if (data.data) {
          data = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
        }
      } catch(e) {
        console.log('Search parse error: ' + e);
        return [];
      }

      const hits = data.hits || [];
      return hits.map(hit => ({
        id: hit.objectID,
        title: hit.name,
        posterUrl: hit.poster_uri,
        url: `${this.baseUrl}/watch/${hit.objectID}?data=${encodeURIComponent(JSON.stringify(hit))}`
      }));
    } catch (e) {
      console.log('Search Error: ' + e);
      return [];
    }
  },

  getEpisodes: async function(animeId) {
    const episodes = [];
    let nextPageToken = null;

    try {
      do {
        const encodedId = encodeURIComponent(animeId);
        let url = this._firestoreUrl(`anime_list/${encodedId}/episodes`) + '?pageSize=300';
        if (nextPageToken) url += `&pageToken=${nextPageToken}`;

        const response = await AppBridge.request(url, { method: 'GET' });
        const data = JSON.parse(response);
        const documents = data.documents;
        if (!documents) break;

        for (const doc of documents) {
          const fields = doc.fields || {};
          const name = fields.name ? fields.name.stringValue : '';
          const numberStr = fields.number ? fields.number.integerValue : '0';
          const number = parseInt(numberStr) || 0;
          const docId = doc.name.split('/').pop();

          episodes.add({
            id: `${animeId}|${docId}`,
            title: name || `الحلقة ${number}`,
            number: number,
            url: docId
          });
        }
        nextPageToken = data.nextPageToken;
      } while (nextPageToken);

      episodes.sort((a, b) => a.number - b.number);
      return episodes;
    } catch (e) {
      console.log('Episodes Error: ' + e);
      return [];
    }
  },

  getServers: async function(episodeId) {
    const parts = episodeId.split('|');
    if (parts.length < 2) return [];

    const animeId = parts[0];
    const epDocId = parts[1];
    const servers = [];

    // Try all_servers first
    try {
      const docPath = `anime_list/${encodeURIComponent(animeId)}/episodes/${encodeURIComponent(epDocId)}/servers2/all_servers`;
      const response = await AppBridge.request(this._firestoreUrl(docPath), { method: 'GET' });
      const data = JSON.parse(response);
      const fields = data.fields || {};

      if (fields.servers && fields.servers.arrayValue && fields.servers.arrayValue.values) {
        for (const val of fields.servers.arrayValue.values) {
          const sFields = val.mapValue.fields || {};
          const name = sFields.name ? sFields.name.stringValue : null;
          const link = sFields.link ? sFields.link.stringValue : null;
          const quality = sFields.quality ? sFields.quality.stringValue : 'Auto';
          const originalLink = sFields.original_link ? sFields.original_link.stringValue : null;

          if (name && link) {
            servers.push({
              name: name,
              category: quality,
              data: JSON.stringify({
                name: name,
                link: link,
                quality: quality,
                original_link: originalLink
              })
            });
          }
        }
      }
    } catch (e) {}

    // Fallback to servers collection if empty
    if (servers.length === 0) {
      try {
        const collPath = `anime_list/${encodeURIComponent(animeId)}/episodes/${encodeURIComponent(epDocId)}/servers`;
        const response = await AppBridge.request(this._firestoreUrl(collPath), { method: 'GET' });
        const data = JSON.parse(response);
        const documents = data.documents;

        if (documents) {
          for (const doc of documents) {
            const fields = doc.fields || {};
            const name = fields.name ? fields.name.stringValue : null;
            const link = fields.link ? fields.link.stringValue : null;
            const quality = fields.quality ? fields.quality.stringValue : 'Auto';
            const visible = fields.visible ? fields.visible.booleanValue : true;

            if (name && link && visible) {
              servers.push({
                name: name,
                category: quality,
                data: JSON.stringify({
                  name: name,
                  link: link,
                  quality: quality
                })
              });
            }
          }
        }
      } catch (e) {}
    }

    return servers;
  },

  getStream: async function(serverDataJson) {
    try {
      const data = JSON.parse(serverDataJson);
      const name = data.name || '';
      const link = data.link || '';
      const originalLink = data.original_link;
      const quality = data.quality || 'Auto';

      // Implementation of extraction logic
      if (name === 'MF' || name === 'MG') {
        return {
          streams: [{ url: link, quality: quality, headers: { 'Referer': this.baseUrl } }]
        };
      }

      // PixelDrain
      if (name === 'PD') {
        const id = link.split('/u/').pop().split('/')[0];
        const proxyUrl = `https://pd.1drv.eu.org/${id}`;
        return {
          streams: [{ url: proxyUrl, quality: quality, headers: { 'Referer': 'https://pixeldrain.com/' } }]
        };
      }

      // StreamTape
      if (name === 'ST') {
        const result = await AppBridge.extractTape(link);
        if (result) return JSON.parse(result);
      }

      // Default fallback
      return {
        streams: [{ url: link, quality: quality, headers: { 'Referer': this.baseUrl } }]
      };
    } catch (e) {
      return null;
    }
  }
};
