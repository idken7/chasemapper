//
//   Project Horus - Browser-Based Chase Mapper - Table Handlers
//
//   Copyright (C) 2019  Mark Jessop <vk5qi@rfhead.net>
//   Released under GNU GPL v3 or later
//

// Allow for the summary window to be expanded with a tap.
var summary_enlarged = false;

function toggleSummarySize(){
    if ($("#summary_table").length === 0) {
        return;
    }
    var row = $("#summary_table").tabulator("getRow", 1);
    if(summary_enlarged == false){
        row.getElement().addClass("largeTableRow");
        summary_enlarged = true;
    }else{
        row.getElement().removeClass("largeTableRow");
        summary_enlarged = false;
    }
    $("#summary_table").tabulator("redraw", true);
}

// Allow for the telemetry table to be expanded/hidden with a click.
var telemetry_table_hidden = false;
var recovery_modal_state = null;

function toggleTelemTableHide(){
    if(telemetry_table_hidden == false){
        $('#telem_table_btn').html("<i class='fa fa-angle-left fa-4x text-center'></i>");
        $("#telem_table").hide("slide", { direction: "right" }, "fast" );
        telemetry_table_hidden = true;
    }else{
        $('#telem_table_btn').html("<i class='fa fa-angle-right fa-4x text-center'></i>");
        $("#telem_table").show("slide", { direction: "right" }, "fast" );
        telemetry_table_hidden = false;
    }
}

function markPayloadRecovered(callsign){
    // Grab the most recent telemetry, along with a few other parameters.
    var _recovery_data = {
        my_call: chase_config.habitat_call,
        payload_call: callsign,
        recovered: $("#recoverySuccessful").is(':checked'),
        recovery_title: callsign, 
        last_pos: balloon_positions[callsign].latest_data.position,
        message: ""
    };

    // Populate fields in the dialog window.
    $('#customRecoveryTitle').val(_recovery_data.recovery_title);
    $('#recoveryPosition').html(_recovery_data.last_pos[0].toFixed(5) + ", " + _recovery_data.last_pos[1].toFixed(5));

    if (chase_config.profiles[chase_config.selected_profile].online_tracker === "sondehub"){
        // Only allow the serial number for sondehub uploads
        $('#customRecoveryTitle').prop('disabled', true);
    } else {
        $('#customRecoveryTitle').prop('disabled', false);
    }

    $('#recoveryModalTitle').text('Mark ' + callsign + ' recovered');
    recovery_modal_state = _recovery_data;
    openRecoveryModal();
}


function setRecoveryCarPosition(){
    // Set recovery position to the chase car position.
    if (!chase_car_position || !chase_car_position.latest_data || chase_car_position.latest_data.length < 2) {
        return;
    }
    $('#recoveryPosition').html(chase_car_position.latest_data[0].toFixed(5) + ", " + chase_car_position.latest_data[1].toFixed(5));
}

function openRecoveryModal() {
    $('#recoveryModal').addClass('is-open').attr('aria-hidden', 'false');
}

function closeRecoveryModal() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    $('#recoveryModal').removeClass('is-open').attr('aria-hidden', 'true');
    recovery_modal_state = null;
}

function submitRecoveryModal() {
    if (!recovery_modal_state) {
        closeRecoveryModal();
        return;
    }

    recovery_modal_state.message = $('#customRecoveryMessage').val();
    recovery_modal_state.recovery_title = $('#customRecoveryTitle').val();
    recovery_modal_state.recovered = $('#recoverySuccessful').is(':checked');

    // If the user has requested to use the chase car position, override the last position with it.
    if ($('#recoveryCarPosition').is(':checked') && chase_car_position && chase_car_position.latest_data) {
        recovery_modal_state.last_pos = chase_car_position.latest_data;
    }

    if (chase_config.profiles[chase_config.selected_profile].online_tracker === 'sondehub') {
        // For sondehub recoveries, do the request in-browser.
        ChaseCar.markRecovered(
            recovery_modal_state.payload_call,
            recovery_modal_state.last_pos[0],
            recovery_modal_state.last_pos[1],
            recovery_modal_state.recovered,
            recovery_modal_state.my_call,
            recovery_modal_state.message
        );
    } else {
        // Habitat 'recoveries' are a bit more involved, so do these in the backend.
        socket.emit('mark_recovered', recovery_modal_state);
    }

    closeRecoveryModal();
}

$(document).on('click', '#recoveryCarPosition', function(){
    if (this.checked) {
        setRecoveryCarPosition();
    } else if (recovery_modal_state && recovery_modal_state.last_pos) {
        $('#recoveryPosition').html(recovery_modal_state.last_pos[0].toFixed(5) + ', ' + recovery_modal_state.last_pos[1].toFixed(5));
    }
});

$(document).on('click', '#recoveryModalCancelBtn', function(){
    closeRecoveryModal();
});

$(document).on('click', '#recoveryModalSubmitBtn', function(){
    submitRecoveryModal();
});

$(document).on('click', '[data-recovery-close="true"]', function(){
    closeRecoveryModal();
});

$(document).on('keydown', function(e){
    if (e.key === 'Escape' && $('#recoveryModal').hasClass('is-open')) {
        closeRecoveryModal();
    }
});


// Dialog box for when a user clicks/taps on a row of the telemetry table.
function telemetryTableDialog(e, row){
    callsign = row.row.data.callsign;

    if (callsign === "None"){
        return;
    }

    // Jump to APRS panel and highlight the callsign
    if (typeof showAprsPanel === 'function') {
        showAprsPanel(callsign);
    }
}

function getTelemetryTableColumns(){
    var isImperial = chase_config['unitselection'] == 'imperial';
    return [
        {title:"Callsign", field:"callsign", headerSort:false},
        {title:"Time", field:"short_time", headerSort:false},
        {title:"Latitude", field:"lat", headerSort:false},
        {title:"Longitude", field:"lon", headerSort:false},
        {title:isImperial ? "Alt (ft)" : "Alt (m)", field:"alt", headerSort:false},
        {title:isImperial ? "V_rate (ft/min)" : "V_rate (m/s)", field:"vel_v", headerSort:false},
        {title:"SVs", field:'sats', headerSort:false, visible:false},
        {title:"SNR", field:'snr', headerSort:false, visible:false},
        {title:"Aux", field:'aux', headerSort:false, visible:false}
    ];
}

function refreshTelemetryTableColumns(){
    if ($('#telem_table').length === 0 || typeof $('#telem_table').tabulator !== 'function') {
        return;
    }

    try {
        $('#telem_table').tabulator('setColumns', getTelemetryTableColumns());
    } catch (e) {
        console.warn('Unable to refresh telemetry table columns:', e);
    }
}


// Initialise tables
function initTables(){
    // Telemetry data table
    if (chase_config['unitselection'] == "imperial") {
        initTablesImperial();
        return;
    } // else do everything in metric

    // Only initialise the telemetry table if the element exists (table may be removed)
    if ($('#telem_table').length > 0 && typeof $('#telem_table').tabulator === 'function'){
        $("#telem_table").tabulator({
            layout:"fitData", 
            layoutColumnsOnNewData:true,
            //selectable:1, // TODO...
            columns:getTelemetryTableColumns(),
            rowClick:function(e, row){telemetryTableDialog(e, row);},
            rowTap:function(e, row){telemetryTableDialog(e, row);}
        });
    }

    if ($("#summary_table").length > 0) {
        $("#summary_table").tabulator({
            layout:"fitData", 
            layoutColumnsOnNewData:true,
            columns:[ //Define Table Columns
                {title:"Alt (m)", field:"alt", headerSort:false},
                {title:"Speed (kph)", field:"speed", headerSort:false},
                {title:"Asc Rate (m/s)", field:"vel_v", headerSort:false},
                {title:"Azimuth", field:"azimuth", headerSort:false},
                {title:"Elevation", field:"elevation", headerSort:false},
                {title:"Range", field:"range", headerSort:false},
            ],
            data:[{id: 1, alt:'-----m', speed:'---kph', vel_v:'-.-m/s', azimuth:'---°', elevation:'--°', range:'----m'}],
            rowClick:function(e, row){
                toggleSummarySize();
            },
            rowTap:function(e, row){
                toggleSummarySize();
            }
        });
    }


    $("#bearing_table").tabulator({
        layout:"fitData", 
        layoutColumnsOnNewData:true,
        //selectable:1, // TODO...
        columns:[ //Define Table Columns
            {title:"Valid", field:'valid_bearing', headerSort:false},
            {title:"Bearing", field:"bearing", headerSort:false},
            {title:"Score", field:'confidence', headerSort:false},
            {title:"Power", field:'power', headerSort:false}
        ],
        data:[{id: 1, valid_bearing:"NO", bearing:0.0, confidence:0.0, power:0.0}]
    });

    $("#bearing_table").hide();
}

// Initialise tables in Imperial - Vertical velocity feet/min, Horizontal velocity Miles/hr, Range Miles then feet for Range < config setting 
function initTablesImperial(){
    // Telemetry data table
    // Only initialise the telemetry table if the element exists (table may be removed)
    if ($('#telem_table').length > 0 && typeof $('#telem_table').tabulator === 'function'){
        $("#telem_table").tabulator({
            layout:"fitData", 
            layoutColumnsOnNewData:true,
            //selectable:1, // TODO...
            columns:getTelemetryTableColumns(),
            rowClick:function(e, row){telemetryTableDialog(e, row);},
            rowTap:function(e, row){telemetryTableDialog(e, row);}
        });
    }

    if ($("#summary_table").length > 0) {
        $("#summary_table").tabulator({
            layout:"fitData", 
            layoutColumnsOnNewData:true,
            columns:[ //Define Table Columns
                {title:"Alt (ft)", field:"alt", headerSort:false},
                {title:"Speed (mph)", field:"speed", headerSort:false},
                {title:"Asc Rate (ft/min)", field:"vel_v", headerSort:false},
                {title:"Azimuth", field:"azimuth", headerSort:false},
                {title:"Elevation", field:"elevation", headerSort:false},
                {title:"Range", field:"range", headerSort:false},
            ],
            data:[{id: 1, alt:'-----ft', speed:'---mph', vel_v:'---ft/min', azimuth:'---°', elevation:'--°', range:'---- miles'}],
            rowClick:function(e, row){
                toggleSummarySize();
            },
            rowTap:function(e, row){
                toggleSummarySize();
            }
        });
    }


    $("#bearing_table").tabulator({
        layout:"fitData", 
        layoutColumnsOnNewData:true,
        //selectable:1, // TODO...
        columns:[ //Define Table Columns
            {title:"Valid", field:'valid_bearing', headerSort:false},
            {title:"Bearing", field:"bearing", headerSort:false},
            {title:"Score", field:'confidence', headerSort:false},
            {title:"Power", field:'power', headerSort:false}
        ],
        data:[{id: 1, valid_bearing:"NO", bearing:0.0, confidence:0.0, power:0.0}]
    });

    $("#bearing_table").hide();
}


function updateTelemetryTable(){
    var telem_data = [];
    if (chase_config['unitselection'] == "imperial") {updateTelemetryTableImperial() ; return ; } // else do everything in metric
    if (jQuery.isEmptyObject(balloon_positions)){
        telem_data = [{callsign:'None'}];
    }else{
        for (balloon_call in balloon_positions){
            var balloon_call_data = Object.assign({},balloon_positions[balloon_call].latest_data);
            var balloon_call_age = balloon_positions[balloon_call].age;

            // Modify some of the fields to fixed point values.
            balloon_call_data.lat = balloon_call_data.position[0].toFixed(5);
            balloon_call_data.lon = balloon_call_data.position[1].toFixed(5);
            balloon_call_data.alt = balloon_call_data.position[2].toFixed(0);
            balloon_call_data.vel_v = balloon_call_data.vel_v.toFixed(1);
            balloon_call_data.short_time = (typeof formatAprsTableTime === 'function') ? formatAprsTableTime(balloon_call_data) : balloon_call_data.short_time;

            // Add in any extra data to the aux field.
            balloon_call_data.aux = "";
            balloon_call_data.snr = "";

            if (balloon_call_data.hasOwnProperty('bt')){
                if ((balloon_call_data.bt >= 0) && (balloon_call_data.bt < 65535)) {
                    balloon_call_data.aux += "BT " + new Date(balloon_call_data.bt*1000).toISOString().substr(11, 8) + " ";
                    $("#telem_table").tabulator("showColumn", "aux");
                }
            }

            if (balloon_positions[balloon_call].hasOwnProperty('snr')){
                if (balloon_positions[balloon_call].snr > -255.0){
                    balloon_call_data.snr = balloon_positions[balloon_call].snr.toFixed(1);
                    $("#telem_table").tabulator("showColumn", "snr");
                }
            }

            if (typeof updateAprsTelemetryRow === 'function'){
                updateAprsTelemetryRow(balloon_call_data);
            }

            if (balloon_call_data.hasOwnProperty('sats')){
                balloon_call_data.sats = balloon_call_data.sats.toFixed(0);
                $("#telem_table").tabulator("showColumn", "sats");
            }

            // Update table
            telem_data.push(balloon_call_data);
        }
    }

    $("#telem_table").tabulator("setData", telem_data);
}

function updateTelemetryTableImperial(){
    var telem_data = [];
    if (jQuery.isEmptyObject(balloon_positions)){
        telem_data = [{callsign:'None'}];
    }else{
        for (balloon_call in balloon_positions){
            var balloon_call_data = Object.assign({},balloon_positions[balloon_call].latest_data);
            var balloon_call_age = balloon_positions[balloon_call].age;

            // Modify some of the fields to fixed point values.
            balloon_call_data.lat = balloon_call_data.position[0].toFixed(5);
            balloon_call_data.lon = balloon_call_data.position[1].toFixed(5);
            balloon_call_data.alt = (balloon_call_data.position[2]*3.28084).toFixed(1);
            balloon_call_data.vel_v = (balloon_call_data.vel_v*3.28084*60).toFixed(1);
            balloon_call_data.short_time = (typeof formatAprsTableTime === 'function') ? formatAprsTableTime(balloon_call_data) : balloon_call_data.short_time;

            // Add in any extra data to the aux field.
            balloon_call_data.aux = "";
            balloon_call_data.snr = "";

            if (balloon_call_data.hasOwnProperty('bt')){
                if ((balloon_call_data.bt >= 0) && (balloon_call_data.bt < 65535)) {
                    balloon_call_data.aux += "BT " + new Date(balloon_call_data.bt*1000).toISOString().substr(11, 8) + " ";
                    $("#telem_table").tabulator("showColumn", "aux");
                }
            }

            if (balloon_positions[balloon_call].hasOwnProperty('snr')){
                if (balloon_positions[balloon_call].snr > -255.0){
                    balloon_call_data.snr = balloon_positions[balloon_call].snr.toFixed(1);
                    $("#telem_table").tabulator("showColumn", "snr");
                }
            }

            if (typeof updateAprsTelemetryRow === 'function'){
                updateAprsTelemetryRow(balloon_call_data);
            }

            // Update table
            telem_data.push(balloon_call_data);
        }
    }

    $("#telem_table").tabulator("setData", telem_data);
}
