// Copyright 2010 and onwards Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Script that runs in the context of the browser action popup.
 *
 * @author manas@google.com (Manas Tungare)
 */

/**
 * Namespace for browser action functionality.
 */
var browseraction = {};

/**
 * @type {string}
 * @const
 * @private
 */
browseraction.QUICK_ADD_API_URL_ = 'https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/quickAdd';
browseraction.INSERT_API_URL = 'https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events';
browseraction.PROFILE_API_URL = 'https://www.googleapis.com/plus/v1/people/me?key={apiKey}';

function i18translate(key) {
    return chrome.i18n.getMessage(key)
}

/**
 * Initializes UI elements in the browser action popup.
 */
browseraction.initialize = function () {
    chrome.extension.getBackgroundPage().background.log('browseraction.initialize()');
    utils.startAnalytics_();
    _gaq.push(['_trackEvent', 'Popup', 'Shown']);
    browseraction.fillMessages_();
    browseraction.installButtonClickHandlers_();
    browseraction.showLoginMessageIfNotAuthenticated_();
    browseraction.loadCalendarsIntoQuickAdd_();
    browseraction.listenForRequests_();
    versioning.checkVersion();
    // browseraction.showDetectedEvents_();
    chrome.extension.sendMessage({method: 'events.feed.get'},
        browseraction.showEventsFromFeed_);
};


/**
 * Fills i18n versions of messages from the Chrome API into DOM objects.
 * @private
 */
browseraction.fillMessages_ = function () {
    // Initialize language for Moment.js.
    moment.lang('en');
    moment.lang(window.navigator.language);
    if (moment.lang() != window.navigator.language) {
        moment.lang(window.navigator.language.substring(0, 2));
    }

    // Load internationalized messages.
    $('.i18n').each(function () {
        var i18nText = i18translate($(this).attr('id').toString());
        if (!i18nText) {
            chrome.extension.getBackgroundPage().background.log(
                'Error getting string for: ', $(this).attr('id').toString());
            return;
        }

        if ($(this).prop('tagName') == 'IMG') {
            $(this).attr({'title': i18nText});
        } else {
            $(this).text(i18nText);
        }
    });

    $('[data-href="calendar_ui_url"]').attr('href', constants.CALENDAR_UI_URL);
    $('#quick-add-event-title').attr({
        'placeholder': i18translate('event_title_placeholder'
        )
    });
};


/** @private */
browseraction.loadCalendarsIntoQuickAdd_ = function () {
    chrome.extension.getBackgroundPage().background.log('browseraction.loadCalendarsIntoQuickAdd_()');
    chrome.storage.local.get('calendars', function (storage) {
        if (chrome.runtime.lastError) {
            background.log('Error retrieving calendars:', chrome.runtime.lastError);
        }

        if (storage['calendars']) {
            var calendars = storage['calendars'];
            var dropDown = $('#quick-add-calendar-list');
            for (var calendarId in calendars) {
                var calendar = calendars[calendarId];
                if (calendar.editable && calendar.visible) {
                    dropDown.append($('<option>', {
                        value: calendar.id,
                        text: calendar.title
                    }));
                }
            }
        }
    });
};


/** @private */
browseraction.installButtonClickHandlers_ = function () {
    $('#authorization_required').on('click', function () {
        $('#authorization_required').text(i18translate('authorization_in_progress'));
        chrome.extension.sendMessage({method: 'authtoken.update'});
    });

    $('#show_quick_add').on('click', function () {
        _gaq.push(['_trackEvent', 'Quick Add', 'Toggled']);
        $(this).toggleClass('rotated');
        $('#quick-add').slideToggle(200);
        $('#quick-add-event-title').focus();
    });

    $('#sync_now').on('click', function () {
        _gaq.push(['_trackEvent', 'Popup', 'Manual Refresh']);
        chrome.extension.sendMessage({method: 'events.feed.fetch'},
            browseraction.showEventsFromFeed_);
    });

    $('#show_options').on('click', function () {
        _gaq.push(['_trackEvent', 'Options', 'Shown']);
        chrome.tabs.create({'url': 'options.html'});
    });

    // $('#quick_add_button').on('click', function () {
    //     _gaq.push(['_trackEvent', 'Quick Add', 'Event Created']);
    //     browseraction.createQuickAddEvent_($('#quick-add-event-title').val().toString(),
    //         $('#quick-add-calendar-list').val());
    //     $('#quick-add-event-title').val('');  // Remove the existing text from the field.
    // });
};


/**
 * Checks if we're logged in and either shows or hides a message asking
 * the user to login.
 * @private
 */
browseraction.showLoginMessageIfNotAuthenticated_ = function () {
    chrome.identity.getAuthToken({'interactive': false}, function (authToken) {
        if (chrome.runtime.lastError || !authToken) {
            chrome.extension.getBackgroundPage().background.log('getAuthToken',
                chrome.runtime.lastError.message);
            browseraction.stopSpinnerRightNow();
            $('#error').show();
            $('#action-bar').hide();
            $('#calendar-events').hide();
        } else {
            $('#error').hide();
            $('#action-bar').show();
            $('#calendar-events').show();
        }
    });
};


/**
 * Listens for incoming requests from other pages of this extension and calls
 * the appropriate (local) functions.
 * @private
 */
browseraction.listenForRequests_ = function () {
    chrome.extension.onMessage.addListener(function (request, sender, opt_callback) {
        switch (request.method) {
            case 'ui.refresh':
                chrome.extension.sendMessage({method: 'events.feed.get'},
                    browseraction.showEventsFromFeed_);
                break;

            case 'sync-icon.spinning.start':
                browseraction.startSpinner();
                break;

            case 'sync-icon.spinning.stop':
                browseraction.stopSpinner();
                break;
        }
    });
};


browseraction.startSpinner = function () {
    $('#sync_now').addClass('spinning');
};

browseraction.stopSpinner = function () {
    $('#sync_now').one('animationiteration webkitAnimationIteration', function () {
        $(this).removeClass('spinning');
    });
};

browseraction.stopSpinnerRightNow = function () {
    $('#sync_now').removeClass('spinning');
};

browseraction.createQuickAddEvent_ = function (room_email, start, timebox, name, roomName) {
    var quickAddUrl = browseraction.INSERT_API_URL.replace('{calendarId}', encodeURIComponent('primary'));

    chrome.identity.getAuthToken({'interactive': false}, function (authToken) {
        if (chrome.runtime.lastError || !authToken) {
            chrome.extension.getBackgroundPage().background.log('getAuthToken', chrome.runtime.lastError.message);
            return;
        }

        browseraction.startSpinner();
        var body = {
            attendees: [{
                email: room_email
            }],
            end: {dateTime: moment(start).add('minutes', timebox).format()},
            start: {dateTime: moment(start).format()},
            summary: name,
            description: "_______\nCreated using MJ extension.",
            location: roomName
        };
        console.log('body', JSON.stringify(body));
        $.ajax(quickAddUrl, {
            type: 'POST',
            headers: {
                'Authorization': 'Bearer ' + authToken,
                'Content-Type': 'application/json'
            },
            data: JSON.stringify(body),
            success: function (response) {
                browseraction.stopSpinner();
                chrome.tabs.create({'url': response.htmlLink});
                chrome.extension.sendMessage({method: 'events.feed.fetch'});
            },
            error: function (response) {
                console.log("error", response);
                browseraction.stopSpinner();
                $('#info_bar').text(i18translate('error_saving_new_event')).slideDown();
                window.setTimeout(function () {
                    $('#info_bar').slideUp();
                }, constants.INFO_BAR_DISMISS_TIMEOUT_MS);
                _gaq.push(['_trackEvent', 'Quick Add', 'Error', response.statusText]);
                chrome.extension.getBackgroundPage().background.log('Error adding Quick Add event', response.statusText);
                if (response.status === 401) {
                    chrome.identity.removeCachedAuthToken({'token': authToken}, function () {
                    });
                }
            }
        });
        $('#quick-add').slideUp(200);
        $('#show_quick_add').toggleClass('rotated');
    });
};

var sortByStartDates = function (a, b) {
    if (a.start != b.start) {
        return a.start - b.start;
    } else if (a.end != b.end) {
        return a.end - b.end;
    } else {
        return a.name.localeCompare(b.name);
    }
};

/**
 * Retrieves events from the calendar feed, sorted by start time, and displays
 * them in the browser action popup.
 * @param {Array} events The events to display.
 * @private
 */
browseraction.showEventsFromFeed_ = function (events) {
    chrome.extension.getBackgroundPage().background.log('browseraction.showEventsFromFeed_()');
    $('#calendar-events').empty();

    chrome.extension.getBackgroundPage().background.updateBadge({'title': ''});

    chrome.identity.getAuthToken({'interactive': false}, function (authToken) {
        if (chrome.runtime.lastError || !authToken) {
            chrome.extension.getBackgroundPage().background.log('getAuthToken',
                chrome.runtime.lastError.message);
            $('#error').show();
            $('#action-bar').hide();
            $('#calendar-events').hide();
        } else {
            $('#error').hide();
            $('#action-bar').show();
            $('#calendar-events').show();
        }
    });

    var rooms = {all: []};
    var event, start, end, i, j, prev, next, room;
    for (i = 0; i < events.length; i++) {
        event = events[i];
        var room_id = event.feed.id;
        if (rooms[room_id] == undefined) {
            rooms.all.push(room_id);
            rooms[room_id] = {
                events: [],
                name: event.feed.title,
                id: event.feed.id,
                holes: [],
                backgroundColor: event.feed.backgroundColor,
                foregroundColor: event.feed.foregroundColor
            }
        }
        rooms[room_id].events.push(event)
    }
    const MIN_DELAY = 5 * 1000;
    for (i = 0; i < rooms.all.length; i++) {
        room = rooms[rooms.all[i]];
        var room_usages = room.events.sort(function (a, b) {
            return a.start - b.start;
        });
        var changes = true;
        while (changes) {
            changes = false;
            var nUsages = [];
            for (j = 0; j < room_usages.length - 1; j++) {
                prev = room_usages[j];
                next = room_usages[j + 1];
                var number = next.start - prev.end;
                if (number <= MIN_DELAY) {
                    var prevEvents = prev.events || [prev];
                    var nextEvents = next.events || [next];
                    nUsages.push({
                        start: prev.start,
                        end: next.end,
                        events: prevEvents.concat(nextEvents),
                        room_id: room.id
                    });
                    j++;
                    changes = true;
                } else if (j == room_usages.length - 2) {
                    nUsages.push(prev, next);
                } else {
                    nUsages.push(prev)
                }
            }
            room_usages = nUsages;
        }
        room.aggregated = room_usages.sort(sortByStartDates);
        for (j = 0; j < room.aggregated.length - 1; j++) {
            prev = room.aggregated[j];
            next = room.aggregated[j + 1];
            var base;
            if (prev.feed != undefined) {
                base = prev;
            } else {
                base = prev.events[0];
            }
            if (next.start - prev.end >= MIN_DELAY) {
                var beginDateTS = utils.fromIso8601(prev.end).startOf('day').valueOf();
                var endDateTS = utils.fromIso8601(next.start).startOf('day').valueOf();
                room.holes.push({
                    start: prev.end,
                    startDate: beginDateTS,
                    endDate: endDateTS,
                    moreDays: beginDateTS != endDateTS,
                    end: next.start,
                    next: next,
                    after: prev,
                    backgroundColor: base.feed.backgroundColor,
                    foregroundColor: base.feed.foregroundColor,
                    name: base.feed.title,
                    room_id: base.feed.id,
                    tillDayEnd: false,
                    fromMorning: false
                })
            }
        }
        var now = moment().valueOf();
        var midnight = moment().startOf('day').add(1, 'day').valueOf();
        // console.log("current time", now, "midnight", midnight);
        if (room.aggregated.length > 0) {
            var eventStart = room.aggregated[0].start;
            if (eventStart > now + MIN_DELAY && eventStart < midnight) {
                room.isFreeTo = eventStart
            } else {
                room.isFreeTo = 0;
            }
        } else {
            console.log("WTF")
        }
    }

    // console.log(rooms);

    var current = [];
    var future = [];
    for (i = 0; i < rooms.all.length; i++) {
        room = rooms[rooms.all[i]];
        if (room.isFreeTo != 0) {
            current.push(room)
        }
        for (j = 0; j < room.holes.length; j++) {
            var hole = room.holes[j];
            if (hole.moreDays) {
                var e = JSON.parse(JSON.stringify(hole));
                e.end = moment(e.start).startOf('hour').hours(18).valueOf();
                e.endDate = moment(e.end).startOf('day').valueOf();
                e.tillDayEnd = true;
                e.moreDays = false;
                future.push(e);
                e = JSON.parse(JSON.stringify(hole));
                e.start = moment(e.end).startOf('hour').hours(8).valueOf();
                e.fromMorning = true;
                e.startDate = moment(e.start).startOf('day').valueOf();
                e.moreDays = false;
                future.push(e);
            } else {
                future.push(hole)
            }
        }
    }
    future = future.sort(sortByStartDates);
    current = current.sort(function (a, b) {
        return a.end < b.end
    });
    // console.log("starting with current", current, "future", future);


    $('<div>').addClass('date-header')
        .text(i18translate('free_rooms'))
        .appendTo($('#calendar-events'));

    if (current.length > 0) {
        for (i = 0; i < current.length; i++) {
            room = current[i];
            end = utils.fromIso8601(room.isFreeTo);
            browseraction.createFreeElemDiv_(room).appendTo($('#calendar-events'));
        }
        var mins = moment(current[0].isFreeTo).diff(moment(), 'minutes');
        chrome.extension.getBackgroundPage().background.updateBadge({'title': '' + mins});
    } else {
        $('<div>').addClass('no-events-today')
            .append(i18translate('no_room_this_moment'))
            .appendTo($('#calendar-events'));
    }

    // Insert a date header for Today as the first item in the list. Any ongoing
    // multi-day events (i.e., started last week, ends next week) will be shown
    // under today's date header, not under the date it started.
    var headerDate = moment().startOf('day');
    $('<div>').addClass('date-header')
        .text(i18translate('today'))
        .appendTo($('#calendar-events'));

    // If there are no events today, then avoid showing an empty date section.
    if (events.length == 0 ||
        moment(events[0].start).diff(headerDate, 'hours') > 23) {
        $('<div>').addClass('no-events-today')
            .append(i18translate('no_events_today'))
            .appendTo($('#calendar-events'));
    }


    for (i = 0; i < future.length; i++) {
        event = future[i];
        start = utils.fromIso8601(event.start);
        end = utils.fromIso8601(event.end);

        // Insert a new date header if the date of this event is not the same as
        // that of the previous event.
        var startDate = start.clone().hours(0).minutes(0).seconds(0);
        if (startDate.diff(headerDate, 'hours') > 23) {
            headerDate = startDate;
            $('<div>').addClass('date-header')
                .text(headerDate.format('dddd, MMMM D'))
                .appendTo($('#calendar-events'));
        }
        browseraction.createFutureHoleDiv_(event).appendTo($('#calendar-events'));
    }

};

function meetingBtn(room_id, start, timebox, title, hoverInfoKey, iconName, cssClass, roomName) {
    return $('<div>').attr({'title': i18translate(hoverInfoKey)}).on('click', function () {
        browseraction.createQuickAddEvent_(room_id, start, timebox, title, roomName);
    }).append($('<img>').addClass(cssClass).attr({
        'src': chrome.extension.getURL(iconName)
    }));
}

/**
 * Creates a <div> that renders a detected event or a fetched event.
 * @param {CalendarEvent} hole The calendar event.
 * @return {!jQuery} The rendered 'Add to Calendar' button.
 * @private
 */
browseraction.createFutureHoleDiv_ = function (hole) {
    var dateTimeFormat = 'HH:mm';
    var start = utils.fromIso8601(hole.start);
    var end = utils.fromIso8601(hole.end);

    var s = start.format(dateTimeFormat);
    if (hole.fromMorning) {
        s = i18translate('from_morning');
    }
    var e = end.format(dateTimeFormat);
    if (hole.tillDayEnd) {
        e = i18translate('till_day_end');
    }
    var eventDiv = /** @type {jQuery} */ ($('<div>')
        .addClass('event')
        .attr({'data-url': hole.gcal_url}));

    if (!start) {  // Some events detected via microformats are malformed.
        return eventDiv;
    }

    // eventDiv.on('click', function () {
    //     console.log(hole);
    //     browseraction.createQuickAddEvent_(hole.room_id, start, 5, 'Stand Up');
    // });

    // var dateTimeFormat = options.get('format24HourTime') ? 'HH:mm' : 'h:mma';
    var startTimeDiv = $('<div>').addClass('start-time');

    startTimeDiv.css({'background-color': hole.backgroundColor});
    // if (!event.allday && !isDetectedEvent) {
    startTimeDiv.text(s + ' - ' + e);
    // }
    startTimeDiv.appendTo(eventDiv);

    var eventDetails = $('<div>')
        .addClass('event-details')
        .appendTo(eventDiv);

    if (moment(hole.end).diff(moment(hole.start), 'minutes') >= 30) {
        meetingBtn(hole.room_id, start, 30, 'Meeting', 'meeting_30', 'icons/meeting.png', 'meeting-icon', hole.name).appendTo(eventDetails);
    }

    if (moment(hole.end).diff(moment(hole.start), 'minutes') >= 15) {
        meetingBtn(hole.room_id, start, 15, 'Stand Up', 'standup_15', 'icons/standup.png', 'standup-icon', hole.name).appendTo(eventDetails);
    }
    //
    // } else if (event.location) {
    //     $('<a>').attr({
    //         'href': 'https://maps.google.com?q=' + encodeURIComponent(event.location),
    //         'target': '_blank'
    //     }).append($('<img>').addClass('location-icon').attr({
    //         'src': chrome.extension.getURL('icons/ic_action_place.png')
    //     })).appendTo(eventDetails);
    // }

    // The location icon goes before the title because it floats right.
    var eventTitle = $('<div>').addClass('event-title').text(hole.name);
    // if (event.responseStatus == constants.EVENT_STATUS_DECLINED) {
    //     eventTitle.addClass('declined');
    // }
    eventTitle.appendTo(eventDetails);

    // if (event.allday && spansMultipleDays || isDetectedEvent) {

    return eventDiv;
};

browseraction.createFreeElemDiv_ = function (room) {
    // console.log("free room", room);
    var end = utils.fromIso8601(room.isFreeTo);

    var eventDiv = /** @type {jQuery} */ ($('<div>')
        .addClass('event')
        .attr({'data-url': room.gcal_url}));

    // eventDiv.on('click', function () {
    //     console.log("ceate event here", room);
    //     browseraction.createQuickAddEvent_(room.id, moment().valueOf(), 5, 'Stand Up');
    // });

    // var timeFormat = options.get('format24HourTime') ? 'HH:mm' : 'h:mm';
    var timeFormat = 'HH:mm';
    var dateTimeFormat = room.allday ? 'MMM D, YYYY' : timeFormat;
    var startTimeDiv = $('<div>').addClass('start-time');

    startTimeDiv.css({'background-color': room.backgroundColor});

    startTimeDiv.text(i18translate('until') + ' ' + end.format(dateTimeFormat));

    startTimeDiv.appendTo(eventDiv);

    var eventDetails = $('<div>')
        .addClass('event-details')
        .appendTo(eventDiv);

    if (moment(room.isFreeTo).diff(moment(), 'minutes') >= 30) {
        meetingBtn(room.id, moment().valueOf(), 30, 'Meeting', 'meeting_30', 'icons/meeting.png', 'meeting-icon', room.name).appendTo(eventDetails);
    }

    if (moment(room.isFreeTo).diff(moment(), 'minutes') >= 15) {
        meetingBtn(room.id, moment().valueOf(), 15, 'Stand Up', 'standup_15', 'icons/standup.png', 'standup-icon', room.name).appendTo(eventDetails);
    }
    // The location icon goes before the title because it floats right.
    var eventTitle = $('<div>').addClass('event-title').text(room.name);
    // if (room.responseStatus == constants.EVENT_STATUS_DECLINED) {
    //     eventTitle.addClass('declined');
    // }
    eventTitle.appendTo(eventDetails);

    // if (room.allday && spansMultipleDays || isDetectedEvent) {
    //     $('<div>')
    //         .addClass('start-and-end-times')
    //         .append(start.format(dateTimeFormat) + ' — ' + end.format(dateTimeFormat))
    //         .appendTo(eventDetails);
    // }
    return eventDiv;
};


/**
 * When the popup is loaded, fetch the events in this tab from the
 * background page, set up the appropriate layout, etc.
 */
window.addEventListener('load', function () {
    browseraction.initialize();
}, false);
