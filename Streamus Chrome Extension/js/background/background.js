﻿//  Background.js is a bit of a dumping ground for code which needs a permanent housing spot.
define(['player', 'backgroundManager', 'localStorageManager', 'pushMessageManager', 'ytHelper', 'error', 'programState', 'repeatButtonStates', 'iconManager'],
    function (player, backgroundManager, localStorageManager, pushMessageManager, ytHelper, Error, programState, repeatButtonStates) {
        'use strict';

    //  TODO: This is the only place I really plan on referencing the error module,
    //  maybe I should move this window.onerror into the Error module?
    //  Send a log message whenever any client errors occur; for debugging purposes.
    window.onerror = function (message, url, lineNumber) {
        
        //  Only log client errors to the database in a deploy environment, not when debugging locally.
        if (!programState.get('isLocal')) {
            var error = new Error({
                message: message,
                url: url,
                lineNumber: lineNumber
            });

            error.save();
        }
    };
        
    player.on('change:state', function (model, state) {

        if (state === PlayerStates.PLAYING) {
            //  Check if the foreground UI is open.
            var foreground = chrome.extension.getViews({ type: "popup" });
  
            if (foreground.length === 0) {

                //  If the foreground UI is not open, show a notification to indicate active video.
                var activeVideoId = backgroundManager.get('activePlaylistItem').get('video').get('id');

                //  TODO: Create HTML notification in the future. Doesn't have all the support we need currently.
                var notification = window.webkitNotifications.createNotification(
                  'http://img.youtube.com/vi/' + activeVideoId + '/default.jpg',
                  'Now Playing',
                  backgroundManager.get('activePlaylistItem').get('title')
                );

                notification.show();

                setTimeout(function () {
                    notification.close();
                }, 3000);
            }
        }
        //  If the video stopped playing and there is another video to play (not the same one), do so.
        else if (state === PlayerStates.ENDED) {

            var activePlaylistItem = backgroundManager.get('activePlaylistItem');
            //  NOTE: No guarantee that the activePlaylistItem's playlistId will be activePlaylist's ID.
            var playlistId = activePlaylistItem.get('playlistId');
            var playlist = backgroundManager.getPlaylistById(playlistId);
            
            var nextItem = playlist.gotoNextItem();

            backgroundManager.set('activePlaylistItem', nextItem);

            var nextVideoId = nextItem.get('video').get('id');
            
            var repeatButtonState = localStorageManager.getRepeatButtonState();
            var shouldRepeatPlaylist = repeatButtonState === repeatButtonStates.REPEAT_PLAYLIST_ENABLED;

            //  Cue the next video if looping around to the top of the playlist and we're not supposed to repeat playlists.
            if (nextItem.get('id') === playlist.get('firstItemId') && !shouldRepeatPlaylist) {
                player.cueVideoById(nextVideoId);
            } else {
                player.loadVideoById(nextVideoId);
            }

        }

    });
    
    //  Receive keyboard shortcuts from users.
    //  TODO: Doesn't seem to be working in production, but does work in dev? Double check.
    chrome.commands.onCommand.addListener(function (command) {
        switch (command) {
            //  TODO: Make this code DRY
            case 'nextVideo':
                var activePlaylistItem = backgroundManager.get('activePlaylistItem');
                
                if (activePlaylistItem !== null) {
                    var playlistId = activePlaylistItem.get('playlistId');
                    var playlist = backgroundManager.getPlaylistById(playlistId);

                    var nextItem = playlist.gotoNextItem();
                    backgroundManager.set('activePlaylistItem', nextItem);
                }

                break;
            case 'previousVideo':
                var activePlaylistItem = backgroundManager.get('activePlaylistItem');

                if (activePlaylistItem !== null) {
                    var playlistId = activePlaylistItem.get('playlistId');
                    var playlist = backgroundManager.getPlaylistById(playlistId);

                    var previousItem = playlist.gotoPreviousItem();
                    backgroundManager.set('activePlaylistItem', previousItem);
                }
                break;
            case 'toggleVideo':
                if (player.isPlaying()) {
                    player.pause();
                } else {
                    player.play();
                }

                break;
        }
    });

    //  Listen for messages from YouTube video pages.
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {

        switch (request.method) {
            //  http://stackoverflow.com/questions/5235719/how-to-copy-text-to-clipboard-from-a-google-chrome-extension
            //  Copies text to the clipboard. Has to happen on background page due to elevated privs.
            case 'copy':

                var hiddenClipboard = document.getElementById("HiddenClipboard");
                hiddenClipboard.value = request.text;
                //  Copy text from hidden field to clipboard.
                hiddenClipboard.select();
                document.execCommand("copy", false, null);
                //  Cleanup
                sendResponse({});

                break;

            case 'getStreams':
                var allStreams = backgroundManager.get('allStreams');
                sendResponse({ streams: allStreams });
                break;
            case 'getPlaylists':                
                var stream = backgroundManager.getStreamById(request.streamId);
                var playlists = stream.get('playlists');

                sendResponse({ playlists: playlists });
                break;
            case 'videoStreamSrcChange':
                player.set('videoStreamSrc', request.videoStreamSrc);
                break;
            case 'addVideoByIdToPlaylist':
                var playlist = backgroundManager.getPlaylistById(request.playlistId);
                
                ytHelper.getVideoInformation({
                    videoId: request.videoId,
                    success: function(videoInformation) {
                        playlist.addItemByInformation(videoInformation);

                        sendResponse({
                            result: 'success'
                        });
                    },
                    error: function() {
                        sendResponse({
                            result: 'error'
                        });
                    }
                });

                break;
            case 'addPlaylistByShareData':
                var activeStream = backgroundManager.get('activeStream');
                
                activeStream.addPlaylistByShareData(request.shareCodeShortId, request.urlFriendlyEntityTitle, function(playlist) {

                    if (playlist) {
                        
                        sendResponse({
                            result: 'success',
                            playlistTitle: playlist.get('title')
                        });
                        
                    } else {
                        
                        sendResponse({
                            result: 'error'
                        });
                        
                    }
                });
                
                break;
        }

        //  Return true to allow sending a response back.
        return true;
    });

    //  TODO: How can I be more DRY with this?
    backgroundManager.get('allPlaylists').on('add', function (playlist) {

        sendEventToOpenYouTubeTabs('add', 'playlist', {
            id: playlist.get('id'),
            title: playlist.get('title')
        });

    });
        
    backgroundManager.get('allPlaylists').on('remove', function (playlist) {

        sendEventToOpenYouTubeTabs('remove', 'playlist', {
            id: playlist.get('id'),
            title: playlist.get('title')
        });

    });
        
    backgroundManager.get('allPlaylists').on('change:title', function (playlist) {

        sendEventToOpenYouTubeTabs('rename', 'playlist', {
            id: playlist.get('id'),
            title: playlist.get('title')
        });

    });
        
    function sendEventToOpenYouTubeTabs(event, type, data) {
        chrome.tabs.query({ url: '*://www.youtube.com/watch?v*' }, function (tabs) {

            _.each(tabs, function (tab) {
                chrome.tabs.sendMessage(tab.id, {
                    event: event,
                    type: type,
                    data: data
                });
            });

        });
    }
        
    //  Modify the iFrame headers to force HTML5 player and to look like we're actually a YouTube page.
    //  The HTML5 player seems more reliable (doesn't crash when Flash goes down) and looking like YouTube
    //  means we can bypass a lot of the embed restrictions.
    chrome.webRequest.onBeforeSendHeaders.addListener(function (info) {
        
        var cookieRequestHeader = _.find(info.requestHeaders, function(requestHeader) {
            return requestHeader.name === 'Cookie';
        });
        
        if (cookieRequestHeader) {

            var flashCookieValue = 'f3=40008';
            var html5CookieValue = 'f2=40001000';
           
            //  Swap out the flash cookie variable with the HTML5 counterpart.
            if (cookieRequestHeader.value.indexOf(flashCookieValue) !== -1) {
                cookieRequestHeader.value = cookieRequestHeader.value.replace(flashCookieValue, html5CookieValue);
            } else {
                cookieRequestHeader.value += '&' + html5CookieValue;
			}

        }
        
        var refererRequestHeader = _.find(info.requestHeaders, function(requestHeader) {
            return requestHeader.name === 'Referer';
        });

        if (refererRequestHeader == null) {
            //  Bypass YouTube's embedded player content restrictions by looking like YouTube
            //  Any referer will do, maybe change to Streamus.com in the future? Or maybe leave as YouTube
            //  to stay under the radar. Not sure which is less suspicious.
            info.requestHeaders.push({
                name: "Referer",
                value: "https://youtube.com/embed/undefined?enablejsapi=1"
            });
        }

        //  Make Streamus look like an iPhone to guarantee the html5 player shows up even if the video has an ad.
        var userAgentRequestHeader = _.find(info.requestHeaders, function(requestHeader) {
            return requestHeader.name === 'User-Agent';
        });

        if (userAgentRequestHeader !== null) {
            userAgentRequestHeader.value = 'Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_2 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8H7 Safari/6533.18.5';
        }

        return { requestHeaders: info.requestHeaders };
    }, {
        urls: ["https://www.youtube.com/embed/undefined?enablejsapi=1"]
    },
        ["blocking", "requestHeaders"]
    );

    //  Build iframe after onBeforeSendHeaders listener to prevent errors and generate correct type of player.
    $('<iframe>', {
        id: 'MusicHolder',
        //  Width and Height should have a ratio of 4 to 3
        width: 480,
        height: 360,
        src: 'https://www.youtube.com/embed/undefined?enablejsapi=1'
    }).appendTo('body');
});