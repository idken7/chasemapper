//
//   Project Horus - Browser-Based Chase Mapper - server connection badge
//
//   Drives the top bar's "LIVE · N connected" badge from the real Socket.IO
//   connection state. It used to be static text, so it kept saying LIVE
//   after the server became unreachable - exactly when a chaser needs to
//   know the map has stopped updating.
//

var SERVER_STATUS_TEXT = {
    connecting: 'CONNECTING',
    live: 'LIVE',
    offline: 'OFFLINE',
    unauthorized: 'KEY NEEDED'
};

function updateServerConnectionDisplay(state){
    if (!Object.prototype.hasOwnProperty.call(SERVER_STATUS_TEXT, state)){
        return;
    }
    var label = document.getElementById('serverStatusLabel');
    if (label){
        label.textContent = SERVER_STATUS_TEXT[state];
        for (var s in SERVER_STATUS_TEXT){
            if (Object.prototype.hasOwnProperty.call(SERVER_STATUS_TEXT, s)){
                label.classList.toggle('server-status-' + s, s === state);
            }
        }
    }
    // The connected count only means something while we're connected; the
    // server re-sends it (presence_update) on every connect.
    if (state !== 'live'){
        var count = document.getElementById('chaserCountLabel');
        if (count){
            count.textContent = '—';
        }
    }
}

function registerSocketStatusHandlers(sock){
    if (!sock || typeof sock.on !== 'function'){
        return;
    }
    sock.on('connect', function(){ updateServerConnectionDisplay('live'); });
    sock.on('disconnect', function(){ updateServerConnectionDisplay('offline'); });
    sock.on('connect_error', function(err){
        var msg = (err && err.message) || '';
        updateServerConnectionDisplay(msg.indexOf('unauthorized') !== -1 ? 'unauthorized' : 'offline');
    });
    if (sock.io && typeof sock.io.on === 'function'){
        sock.io.on('reconnect_attempt', function(){ updateServerConnectionDisplay('connecting'); });
    }
    if (sock.connected){
        updateServerConnectionDisplay('live');
    }
}
