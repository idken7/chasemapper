//
//   Project Horus - Browser-Based Chase Mapper - API key handling
//
//   Shared by index.html, bearing_entry.html and oclock.html. Load it right
//   after jQuery and socket.io, before any page script that makes an AJAX
//   request or opens the Socket.IO connection.
//
//   When the server has CHASEMAPPER_API_KEY set (see README "Endpoint
//   Security"), its guarded endpoints (/get_config, /get_telemetry_archive,
//   /get_bearings, /api/*) and the Socket.IO connection need that key. The
//   key is kept in this browser's localStorage and sent:
//     - as an X-API-Key header on same-origin jQuery AJAX requests, and
//     - as an api_key query parameter on the Socket.IO connection.
//   It's harmless to send when the server doesn't require it.
//

var CHASEMAPPER_API_KEY_STORAGE_KEY = 'chasemapper_api_key';

function getSavedApiKey(){
    try{ return localStorage.getItem(CHASEMAPPER_API_KEY_STORAGE_KEY) || ''; }catch(e){ return ''; }
}

function setSavedApiKey(key){
    try{ localStorage.setItem(CHASEMAPPER_API_KEY_STORAGE_KEY, key || ''); }catch(e){ /* ignore */ }
}

// True only for requests to this page's own server. The key must never be
// sent to third-party hosts (SondeHub, Habitat etc. are also called via
// $.ajax) - that would leak it, and the extra header would make those
// cross-origin requests fail CORS preflight.
function isSameOriginUrl(url){
    if (!url){
        return true;
    }
    try{
        return new URL(url, window.location.href).origin === window.location.origin;
    }catch(e){
        return false;
    }
}

// Headers for a same-origin fetch() to this server: `headers` plus the saved
// key as X-API-Key (when one is saved). jQuery requests get the key
// automatically via ajaxSetup below; fetch() calls need this explicitly.
function chasemapperAuthHeaders(headers){
    var out = {};
    var src = headers || {};
    for (var k in src){
        if (Object.prototype.hasOwnProperty.call(src, k)){
            out[k] = src[k];
        }
    }
    var key = getSavedApiKey();
    if (key){
        out['X-API-Key'] = key;
    }
    return out;
}

// Options for io.connect(): carries the saved key, if any.
function chasemapperSocketOptions(){
    var key = getSavedApiKey();
    return key ? {query: {api_key: key}} : {};
}

// Separate function so tests can replace it (jsdom can't navigate).
function chasemapperReloadPage(){
    window.location.reload();
}

// Ask for the key, save it and reload so every request and the Socket.IO
// connection pick it up. Several requests can fail at once (e.g. config,
// archive and bearings all 401 on page load), so only prompt once per page
// load.
var _apiKeyPromptShown = false;
function promptForApiKeyAndReload(){
    if (_apiKeyPromptShown){
        return false;
    }
    _apiKeyPromptShown = true;
    var entered = window.prompt('This server requires an API key to connect. Enter it below:');
    if (entered && entered.trim()){
        setSavedApiKey(entered.trim());
        chasemapperReloadPage();
        return true;
    }
    return false;
}

// Socket.IO refuses an unauthorized connection with a connect_error whose
// message is "unauthorized" (see handle_socketio_connect in horusmapper.py).
function registerSocketAuthHandler(sock){
    if (!sock || typeof sock.on !== 'function'){
        return;
    }
    sock.on('connect_error', function(err){
        var msg = (err && err.message) || '';
        if (msg.indexOf('unauthorized') === -1){
            return;
        }
        promptForApiKeyAndReload();
    });
}

if (typeof jQuery !== 'undefined'){
    jQuery.ajaxSetup({
        beforeSend: function(xhr, settings){
            var key = getSavedApiKey();
            if (key && !(settings && settings.crossDomain) && isSameOriginUrl(settings && settings.url)){
                xhr.setRequestHeader('X-API-Key', key);
            }
        }
    });

    jQuery(document).ajaxError(function(event, xhr, settings){
        if (xhr && xhr.status === 401 && isSameOriginUrl(settings && settings.url)){
            promptForApiKeyAndReload();
        }
    });
}
