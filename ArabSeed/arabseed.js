var arabseed = {
  baseUrl: 'https://asd.pics',
  userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',

  getInfo: async function() {
    return {
      id: 'arabseed',
      name: 'ArabSeed (JS)',
      version: '1.0.1',
      author: 'Admin',
      language: 'ar',
      min_app_version: '1.3.1'
    };
  },

  search: async function(query) {
    try {
      let encodedQuery = encodeURIComponent(query);
      let res = await AppBridge.get(this.baseUrl + '/find/?word=' + encodedQuery, {
        'User-Agent': this.userAgent,
        'Accept': 'text/html'
      });
      
      let html = res.data;
      
      let selectors = [
        '.item__contents',
        '.MovieBlock',
        '.BlockItem',
        '.BoxOffice--Item',
        'article'
      ];

      let results = [];
      let seenUrls = new Set();

      for (let selector of selectors) {
        let queryRes = await AppBridge.query(html, selector);
        let items = queryRes.elements || [];
        
        for (let item of items) {
          // Find 'a' and 'img' manually using sub-queries since item is just an object here, 
          // but AppBridge.query() only returns the top level nodes.
          // Wait, AppBridge.query returns outerHtml. We can query the outerHtml!
          let linkRes = await AppBridge.queryOne(item.outerHtml, 'a');
          if (!linkRes) continue;
          
          let href = linkRes.attributes['href'];
          if (!href) continue;

          if (href.startsWith('/')) href = this.baseUrl + href;
          if (!href.includes(this.baseUrl)) continue;
          if (seenUrls.has(href)) continue;
          seenUrls.add(href);

          let imgRes = await AppBridge.queryOne(item.outerHtml, 'img');
          let poster = '';
          if (imgRes) {
             poster = imgRes.attributes['src'] || imgRes.attributes['data-src'] || '';
          }

          let title = '';
          let titleRes = await AppBridge.queryOne(item.outerHtml, '.post__info h3, .Title, h3, h4');
          if (titleRes) {
            title = titleRes.text;
          } else {
            title = linkRes.attributes['title'] || (imgRes ? imgRes.attributes['alt'] : '') || '';
          }

          title = title.trim();
          if (!title) continue;

          results.push({
            id: href,
            title: title,
            posterUrl: poster,
            url: href
          });
        }
        if (results.length > 0) break;
      }
      return results;
    } catch (e) {
      return [];
    }
  },

  getEpisodes: async function(contentId) {
    try {
      let res = await AppBridge.get(contentId, {'User-Agent': this.userAgent});
      let html = res.data;

      let episodes = [];
      let seenUrls = new Set();

      let containerRes = await AppBridge.queryOne(html, '.ContainerEpisodes, .EpisodesList, .episodes-list, .list-episodes, .episodes__list, .episodes__container');
      
      if (containerRes && containerRes.outerHtml) {
        let linksRes = await AppBridge.query(containerRes.outerHtml, 'a');
        let links = linksRes.elements || [];
        
        for (let link of links) {
          let href = link.attributes['href'] || '';
          let text = link.text;

          let match = text.match(/الحلقة\s*(\d+)/);
          if (!match) continue;

          let fullHref = href;
          if (href.startsWith('/')) fullHref = this.baseUrl + href;
          if (!fullHref.includes(this.baseUrl)) continue;
          if (seenUrls.has(fullHref)) continue;
          seenUrls.add(fullHref);

          let epNum = parseInt(match[1]) || 1;

          episodes.push({
            id: fullHref,
            title: 'Episode ' + epNum,
            number: epNum,
            url: fullHref
          });
        }
      }

      if (episodes.length === 0) {
        episodes.push({
          id: contentId,
          title: 'Full Movie',
          number: 1,
          url: contentId
        });
      }

      episodes.sort((a, b) => a.number - b.number);
      return episodes;
    } catch (e) {
      return [];
    }
  },

  getServers: async function(episodeId) {
    try {
      let epRes = await AppBridge.get(episodeId, {'User-Agent': this.userAgent});
      let episodeHtml = epRes.data;

      let watchBtn = await AppBridge.queryOne(episodeHtml, 'a.btton.watch__btn');
      let watchUrl = episodeId;

      if (watchBtn) {
        let href = watchBtn.attributes['href'] || '';
        if (href) {
          if (href.startsWith('/')) watchUrl = this.baseUrl + href;
          else if (href.startsWith('//')) watchUrl = 'https:' + href;
          else watchUrl = href;
        }
      } else if (!watchUrl.includes('/watch/')) {
        if (!watchUrl.endsWith('/')) watchUrl += '/';
        watchUrl += 'watch/';
      }

      let watchRes = await AppBridge.get(watchUrl, {
        'Referer': episodeId,
        'User-Agent': this.userAgent
      });
      let watchHtml = watchRes.data;

      let tokenMatch = watchHtml.match(/['"]csrf__token['"]\s*:\s*['"]([^'"]+)['"]/);
      let csrfToken = tokenMatch ? tokenMatch[1] : '';

      let serversListLi = await AppBridge.queryOne(watchHtml, '.servers__list li');
      let postId = serversListLi ? (serversListLi.attributes['data-post'] || '') : '';

      if (!csrfToken || !postId) {
        return await this._fallbackGetServers(watchHtml, watchUrl);
      }

      let qualityItemsRes = await AppBridge.query(watchHtml, '.quality__swither ul.qualities__list li');
      let qualityItems = qualityItemsRes.elements || [];

      let groupedServers = {};

      for (let item of qualityItems) {
        let quality = item.attributes['data-quality'] || '';
        if (!quality) continue;

        try {
          let sRes = await AppBridge.post(this.baseUrl + '/get__quality__servers/', {
            'post_id': postId,
            'quality': quality,
            'csrf_token': csrfToken
          }, {
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': watchUrl,
            'User-Agent': this.userAgent
          });

          let serversHtml = '';
          if (typeof sRes.data === 'string') {
            try {
               let dec = JSON.parse(sRes.data);
               serversHtml = dec.html || sRes.data;
            } catch (e) {
               serversHtml = sRes.data;
            }
          } else {
            serversHtml = sRes.data.html || '';
          }

          if (!serversHtml) continue;

          let btnRes = await AppBridge.query(serversHtml, 'li');
          let serverButtons = btnRes.elements || [];

          for (let btn of serverButtons) {
            let serverName = btn.text;
            let serverId = btn.attributes['data-server'] || '';

            if (serverId) {
              if (!groupedServers[serverName]) {
                groupedServers[serverName] = {};
              }
              groupedServers[serverName][quality] = {
                'post_id': postId,
                'quality': quality,
                'server_id': serverId,
                'csrf_token': csrfToken,
                'watch_url': watchUrl,
                'type': 'new_api'
              };
            }
          }
        } catch (e) {}
      }

      let servers = [];
      
      // We skip the Byse checking in JS to save time, or we can just filter out based on URL later.
      // Or we can fetch the first quality URL. For performance, we'll let Dart Extractor fail gracefully if Byse is broken.
      
      for (let name in groupedServers) {
        let qMap = groupedServers[name];
        servers.push({
          name: name,
          data: JSON.stringify({'type': 'grouped', 'qualities': qMap}),
          category: Object.keys(qMap).join(', ')
        });
      }

      let dServers = await this._extractDownloadServers(watchHtml);
      servers = servers.concat(dServers);

      if (servers.length === 0) {
        return await this._fallbackGetServers(watchHtml, watchUrl);
      }

      return servers;
    } catch (e) {
      return [{name: 'ArabSeed (Auto)', data: episodeId}];
    }
  },

  _fallbackGetServers: async function(html, watchUrl) {
    let servers = [];
    let btnsRes = await AppBridge.query(html, '.serversList li, .ServersList li, [data-server], .server-btn');
    let btns = btnsRes.elements || [];

    for (let btn of btns) {
      let serverName = btn.text || 'Server';
      let serverData = btn.attributes['data-server'] || btn.attributes['data-id'] || '';

      if (serverData) {
        servers.push({
          name: serverName,
          data: JSON.stringify({
            'url': watchUrl + '?server=' + serverData,
            'type': 'legacy'
          })
        });
      }
    }
    return servers;
  },

  _extractDownloadServers: async function(html) {
    let servers = [];
    let linksRes = await AppBridge.query(html, '.DownloadLinks a, .download-list a, .downloads a');
    let downloadLinks = linksRes.elements || [];

    if (downloadLinks.length === 0) {
      let allLinksRes = await AppBridge.query(html, 'a');
      let allLinks = allLinksRes.elements || [];
      for (let link of allLinks) {
        let t = link.text.toLowerCase();
        if (t.includes('تحميل') || t.includes('download')) {
           let href = link.attributes['href'];
           if (href && !href.startsWith('#')) {
             downloadLinks.push(link);
           }
        }
      }
    }

    for (let link of downloadLinks) {
      let name = link.text;
      let href = link.attributes['href'] || '';
      if (!href) continue;

      if (href.startsWith('/')) href = this.baseUrl + href;
      
      let cleanName = name.replace('تحميل', '').trim().toLowerCase();
      
      if (cleanName.includes('عرب سيد') || cleanName.includes('سيرفر الموقع') || cleanName.includes('arab seed') || cleanName.includes('arabseed')) {
        servers.push({
          name: 'عرب سيد',
          data: JSON.stringify({'url': href, 'type': 'direct'}),
          category: 'تحميل مباشر'
        });
        break;
      }
    }
    return servers;
  },

  getStream: async function(serverDataStr) {
    try {
      let data = JSON.parse(serverDataStr);
      let type = data.type || 'legacy';

      if (type === 'grouped') {
        let qualities = data.qualities || {};
        let allStreams = [];
        let seenUrls = new Set();
        
        let qKeys = Object.keys(qualities).sort((a, b) => {
           let qa = parseInt(a.replace(/[^0-9]/g, '')) || 0;
           let qb = parseInt(b.replace(/[^0-9]/g, '')) || 0;
           return qb - qa;
        });

        for (let key of qKeys) {
          let qData = qualities[key];
          try {
            let iframeUrl = await this._getIframeUrl(qData);
            if (iframeUrl) {
               let streamRes = await AppBridge.extractStream(iframeUrl, qData.watch_url || this.baseUrl);
               if (streamRes && streamRes.streams) {
                  let s = streamRes.streams[0];
                  if (s && !seenUrls.has(s.url)) {
                     seenUrls.add(s.url);
                     allStreams.push({
                        url: s.url,
                        quality: key.includes('p') ? key : key + 'p',
                        headers: s.headers
                     });
                  }
               }
            }
          } catch(e) {}
        }
        if (allStreams.length > 0) return {streams: allStreams};
        return null;
      }

      if (type === 'direct') {
        return {
          streams: [
            {
              url: data.url,
              quality: 'Auto',
              headers: {'Referer': this.baseUrl}
            }
          ]
        };
      }

      let iframeUrl;
      if (type === 'new_api') {
        iframeUrl = await this._getIframeUrl(data);
      } else {
        iframeUrl = data.url;
      }

      if (!iframeUrl) return null;
      
      if (iframeUrl.startsWith('//')) iframeUrl = 'https:' + iframeUrl;
      else if (iframeUrl.startsWith('/')) iframeUrl = this.baseUrl + iframeUrl;

      let streamRes = await AppBridge.extractStream(iframeUrl, data.watch_url || this.baseUrl);
      if (streamRes) return streamRes;
      
      return null;
    } catch(e) {
      return null;
    }
  },

  _getIframeUrl: async function(data) {
    try {
      let res = await AppBridge.post(this.baseUrl + '/get__watch__server/', {
        'post_id': data.post_id,
        'quality': data.quality,
        'server': data.server_id,
        'csrf_token': data.csrf_token
      }, {
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': data.watch_url || this.baseUrl,
        'User-Agent': this.userAgent
      });

      let resData = res.data;
      if (typeof resData === 'string') {
        try {
          let dec = JSON.parse(resData);
          return dec.server;
        } catch(e) {
          let m = resData.match(/(https?:\/\/[^\s"\'<>]+)/);
          if (m) return m[1];
        }
      } else if (resData && resData.server) {
        return resData.server.toString();
      }
    } catch (e) {}
    return null;
  }
};
