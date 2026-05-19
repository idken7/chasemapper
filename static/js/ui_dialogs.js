(function(){
    window.createAppDialog = function(id, title, htmlContents, opts){
        opts = opts || {};
        var width = opts.width || 420;
        var modal = (typeof opts.modal === 'boolean') ? opts.modal : false;

        if (document.getElementById(id)) return document.getElementById(id);

        var $el = $('<div>').attr('id', id).addClass('chasemapper-dialog ui-dialog').attr('title', title).html(htmlContents).hide();
        $('body').append($el);

        $el.dialog({autoOpen:false, width: width, modal: modal, dialogClass: 'chasemapper-ui-dialog'});

        return $el[0];
    };

    // Simple toast helper to show brief messages to the user
    window.showAppToast = function(msg, timeout){
        timeout = timeout || 3000;
        var id = 'app-toast';
        var $t = $('#' + id);
        if ($t.length === 0){
            $t = $('<div>').attr('id', id).css({position:'fixed', bottom:'20px', right:'20px', background:'rgba(0,0,0,0.8)', color:'#fff', padding:'8px 12px', borderRadius:'4px', zIndex:99999, fontSize:'13px'});
            $('body').append($t);
        }
        $t.text(msg).fadeIn(200);
        setTimeout(function(){ $t.fadeOut(300); }, timeout);
    };

})();
