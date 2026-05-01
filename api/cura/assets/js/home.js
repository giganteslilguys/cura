import { Socket, Presence } from 'phoenix';

const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Initialize these as null - they'll be set in mounted()
let localVideoPlayer = null;
let videoPlayerWrapper = null;
let peerCount = null;
let connectionStatus = null;
let localMuteIndicator = null;
let localVideoIndicator = null;
let meetingTime = null;
let participantsSidebar = null;

let localStream = undefined;
let channel = undefined;
let pc = undefined;
let localTracksAdded = false;
let isMuted = true;
let isVideoEnabled = true;
let meetingStartTime = new Date();
let meetingTimer = null;
let isScreenSharing = false;
let screenShareStream = undefined;
let originalVideoTrack = undefined;
let customCameraStream = undefined;
let cameraOffPlaceholder = undefined;
let screenShareSignalTime = null;
let remoteStream = null;
let remoteAudioElement = null; // Separate audio element for remote audio (video element is muted)
let isCallEnding = false; // Track when call is being intentionally ended

let participantsPanelOpen = false;

function checkRecentScreenShareSignal() {
  // Check if a screen share signal was received in the last 2 seconds
  if (!screenShareSignalTime) return false;
  const now = Date.now();
  return (now - screenShareSignalTime) < 2000;
}

function startMeetingTimer() {
  meetingTimer = setInterval(() => {
    const now = new Date();
    const duration = Math.floor((now - meetingStartTime) / 1000);
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = duration % 60;

    if (meetingTime) {
      if (hours > 0) {
        meetingTime.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      } else {
        meetingTime.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
    }
  }, 1000);
}

function updateStatusIndicators() {
  if (localMuteIndicator) {
    localMuteIndicator.className = isMuted 
      ? 'w-8 h-8 bg-red-500/90 backdrop-blur-sm rounded-full flex items-center justify-center'
      : 'w-8 h-8 bg-green-500/90 backdrop-blur-sm rounded-full flex items-center justify-center';
    
    const icon = localMuteIndicator.querySelector('svg');
    if (icon) {
      icon.setAttribute('name', isMuted ? 'hero-microphone-slash' : 'hero-microphone');
    }
  }

  if (localVideoIndicator) {
    localVideoIndicator.className = isVideoEnabled 
      ? 'w-8 h-8 bg-green-500/90 backdrop-blur-sm rounded-full flex items-center justify-center'
      : 'w-8 h-8 bg-red-500/90 backdrop-blur-sm rounded-full flex items-center justify-center';
    
    const icon = localVideoIndicator.querySelector('svg');
    if (icon) {
      icon.setAttribute('name', isVideoEnabled ? 'hero-video-camera' : 'hero-video-camera-slash');
    }
  }

  const muteBtn = document.getElementById('mute-btn');
  const videoBtn = document.getElementById('video-btn');
  const muteIcon = document.getElementById('mute-icon');
  const videoIcon = document.getElementById('video-icon');

  if (muteBtn && muteIcon) {
    if (isMuted) {
      muteBtn.className = 'group relative w-12 h-12 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105';
      muteIcon.className = 'w-6 h-6 text-white';
    } else {
      muteBtn.className = 'group relative w-12 h-12 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105 border-2 border-gray-300';
      muteIcon.className = 'w-6 h-6 text-gray-700';
    }
    muteIcon.setAttribute('name', isMuted ? 'hero-microphone-slash' : 'hero-microphone-solid');
  }

  if (videoBtn && videoIcon) {
    if (!isVideoEnabled) {
      videoBtn.className = 'group relative w-12 h-12 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105';
      videoIcon.className = 'w-6 h-6 text-white';
    } else {
      videoBtn.className = 'group relative w-12 h-12 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105 border-2 border-gray-300';
      videoIcon.className = 'w-6 h-6 text-gray-700';
    }
    videoIcon.setAttribute('name', isVideoEnabled ? 'hero-video-camera' : 'hero-video-camera-slash');
  }
}

async function createPeerConnection() {
  pc = new RTCPeerConnection(pcConfig);

  pc.ontrack = (event) => {
    console.log('========== RECEIVED TRACK ==========');
    console.log('Track kind:', event.track.kind);
    console.log('Track label:', event.track.label);
    console.log('Track ID:', event.track.id);
    console.log('Streams:', event.streams.length);
    if (event.streams.length > 0) {
      console.log('Stream ID:', event.streams[0].id);
      console.log('Stream tracks:', event.streams[0].getTracks().map(t => ({kind: t.kind, id: t.id, label: t.label})));
    }
    console.log('====================================');

    if (event.track.kind == 'video') {
      const trackId = event.track.id;
      const streamId = event.streams[0].id;
      
      // ENHANCED screen share detection with multiple fallbacks
      const isScreenShareTrack = 
        // Check custom property first (most reliable)
        event.track._isScreenShare ||
        // Check label patterns
        (event.track.label && (
          event.track.label.includes('screen') || 
          event.track.label.includes('Screen') ||
          event.track.label === 'screen-share-track' ||
          event.track.label.startsWith('screenshare:')
        )) ||
        // Check content hint
        event.track.contentHint === 'detail' ||
        event.track.contentHint === 'text' ||
        // Check for screen share signal received recently
        checkRecentScreenShareSignal();

      console.log('Video track received. Is screen share:', isScreenShareTrack, 'Label:', event.track.label, 'ContentHint:', event.track.contentHint);

      if (isScreenShareTrack) {
        console.log('Handling as screen share track');
        handleIncomingScreenShare(event, trackId);
      } else {
        console.log('Handling as participant track');
        handleIncomingParticipant(event, trackId);
      }

      event.track.onended = (_) => {
        console.log('Track ended:', event.track.kind, 'Is screen share:', isScreenShareTrack);
        if (isScreenShareTrack) {
          removeScreenShare();
        } else {
          // Clean up remote participant when their track ends
          console.log('Remote participant track ended, cleaning up...');
          const remoteContainer = document.getElementById('remote-video-container');
          const remoteVideo = document.getElementById('videoplayer-remote');
          
          if (remoteContainer) {
            console.log('Hiding remote container due to track end');
            remoteContainer.classList.add('hidden');
            
            if (remoteVideo) {
              remoteVideo.srcObject = null;
              remoteVideo.style.display = 'none';
            }
            
            // Remove any placeholders
            const placeholder = remoteContainer.querySelector('.no-video-placeholder');
            if (placeholder) {
              placeholder.remove();
            }
          }
          
          // CRITICAL: Query actual presence count instead of assuming 1
          // This prevents incorrect reset when audio track ends
          setTimeout(() => {
            if (channel && channel.state === 'joined') {
              const presenceList = new Presence(channel).list();
              const actualCount = presenceList ? Object.keys(presenceList).length : 1;
              console.log('Track ended - actual presence count:', actualCount);
              updateParticipantDisplays(actualCount);
            } else {
              // Fallback only if channel is not available
              console.log('Channel not available, using fallback presence update');
              updateParticipantCount();
            }
          }, 100);
          
          // Update grid layout
          updateVideoGrid();
        }
      };
    } else if (event.track.kind == 'audio') {
      console.log('Received audio track:', event.track.label);
      
      // Create audio element if it doesn't exist
      if (!remoteAudioElement) {
        remoteAudioElement = document.createElement('audio');
        remoteAudioElement.autoplay = true;
        remoteAudioElement.id = 'remote-audio-player';
        document.body.appendChild(remoteAudioElement);
        console.log('Created remote audio element');
      }
      
      // Create or get audio stream
      if (!remoteAudioElement.srcObject) {
        remoteAudioElement.srcObject = new MediaStream();
      }
      
      // Add the audio track to the audio element's stream
      remoteAudioElement.srcObject.addTrack(event.track);
      console.log('Added audio track to remote audio element. Total audio tracks:', remoteAudioElement.srcObject.getAudioTracks().length);
      
      // Ensure audio is playing
      remoteAudioElement.play()
        .then(() => console.log('✅ Remote audio playing'))
        .catch(err => {
          console.error('Failed to play remote audio:', err);
          // If autoplay failed, wait for user interaction
          const playAudioOnClick = () => {
            remoteAudioElement.play()
              .then(() => console.log('✅ Audio playing after user interaction'))
              .catch(e => console.error('Audio still failed:', e));
          };
          document.addEventListener('click', playAudioOnClick, { once: true });
          showToast('Click to enable audio', 2000);
        });
    }
  };

  pc.onicegatheringstatechange = () => {
    console.log('ICE gathering state:', pc.iceGatheringState);
  };

  pc.onconnectionstatechange = () => {
    console.log('========== CONNECTION STATE CHANGE ==========');
    console.log('Connection state:', pc.connectionState);
    console.log('ICE connection state:', pc.iceConnectionState);
    console.log('ICE gathering state:', pc.iceGatheringState);
    console.log('Signaling state:', pc.signalingState);
    console.log('Is call ending:', isCallEnding);
    console.log('==========================================');
    
    if (connectionStatus) {
      switch (pc.connectionState) {
        case 'connected':
          connectionStatus.className = 'w-2 h-2 bg-green-500 rounded-full animate-pulse';
          console.log('✅ Peer connection established!');
          break;
        case 'connecting':
          connectionStatus.className = 'w-2 h-2 bg-yellow-500 rounded-full animate-pulse';
          break;
        case 'disconnected':
        case 'failed':
          connectionStatus.className = 'w-2 h-2 bg-red-500 rounded-full';
          console.log('❌ Peer connection failed or disconnected');
          
          // Only attempt restart if call is NOT being intentionally ended
          if (!isCallEnding && pc.connectionState == 'failed') {
            console.log('Connection failed - attempting ICE restart...');
            pc.restartIce();
          }
          break;
        default:
          connectionStatus.className = 'w-2 h-2 bg-gray-500 rounded-full';
      }
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate == null) {
      return;
    }

    const candidate = JSON.stringify(event.candidate);
    channel.push('ice_candidate', { body: candidate });
  };

  // Negotiation is server-controlled in this SFU design.
  // Only allow browser-initiated renegotiation for screen sharing.
  pc.onnegotiationneeded = async () => {
    if (!isScreenSharing) {
      console.log('onnegotiationneeded fired (not screen sharing) — ignoring, server controls renegotiation');
      return;
    }

    console.log('onnegotiationneeded — screen sharing renegotiation');

    try {
      if (pc.signalingState !== 'stable') {
        console.log('Signaling state not stable, queuing screen share negotiation');
        setTimeout(() => {
          if (pc.signalingState === 'stable') pc.onnegotiationneeded();
        }, 100);
        return;
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      channel.push('sdp_offer', { body: offer.sdp });
    } catch (error) {
      console.error('Error during screen share negotiation:', error);
    }
  };
}

function handleIncomingScreenShare(event, trackId) {
  console.log('========== INCOMING SCREEN SHARE ==========');
  console.log('Screen share track received');
  console.log('Current remote stream status:', {
    hasRemoteStream: !!remoteStream,
    remoteTracks: remoteStream ? remoteStream.getTracks().length : 0,
    remoteVideoTracks: remoteStream ? remoteStream.getVideoTracks().length : 0,
    remoteAudioTracks: remoteStream ? remoteStream.getAudioTracks().length : 0
  });
  console.log('===========================================');
  
  const screenShareVideo = document.getElementById('videoplayer-screenshare');
  
  if (screenShareVideo) {
    console.log('Setting screen share video source');
    screenShareVideo.srcObject = event.streams[0];
    screenShareVideo.autoplay = true;
    screenShareVideo.playsinline = true;
    screenShareVideo.muted = false; // Allow audio from screen share
    
    // Force screen share video to play
    screenShareVideo.play().catch(e => {
      console.log('Screen share video autoplay prevented:', e);
      // Add click handler for user interaction
      const enableOnClick = () => {
        screenShareVideo.play().catch(console.log);
        document.removeEventListener('click', enableOnClick);
      };
      document.addEventListener('click', enableOnClick, { once: true });
      showToast('Click anywhere to start screen share playback');
    });
    
    // CRITICAL: Show screen share layout
    // This will also show the remote participant's camera in the small view if available
    showScreenShareLayout();
    
    const nameLabel = document.getElementById('screenshare-participant-name');
    if (nameLabel) {
      nameLabel.textContent = 'Screen Share - Participant';
    }
    
    console.log('Screen share layout should now be visible');
  } else {
    console.error('Screen share video element not found');
  }
}

function handleIncomingParticipant(event, trackId) {
  console.log('handleIncomingParticipant called - this should be camera feed');
  console.log('Track details:', {
    trackId, 
    streamId: event.streams[0].id,
    label: event.track.label,
    contentHint: event.track.contentHint,
    isScreenShare: event.track._isScreenShare
  });
  
  const remoteContainer = document.getElementById('remote-video-container');
  const remoteVideo = document.getElementById('videoplayer-remote');
  
  const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  console.log('📱 Mobile device:', isMobileDevice, 'remoteContainer exists:', !!remoteContainer, 'remoteVideo exists:', !!remoteVideo);
  
  if (!remoteContainer) {
    console.error('❌ CRITICAL: remote-video-container NOT FOUND in DOM');
    return;
  }
  if (!remoteVideo) {
    console.error('❌ CRITICAL: videoplayer-remote NOT FOUND in DOM');
    return;
  }
  
  if (remoteContainer && remoteVideo) {
    console.log('Setting up remote participant camera in separate container');
    
    // Detect mobile early for initial setup
    const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobileDevice) {
      console.log('📱 Mobile device detected - configuring video element for mobile compatibility');
      // Set mobile-specific attributes
      remoteVideo.setAttribute('playsinline', 'true');
      remoteVideo.setAttribute('webkit-playsinline', 'true');
      remoteVideo.playsInline = true;
    }
    
    // Initialize remoteStream if it doesn't exist
    const isNewStream = !remoteStream;
    if (!remoteStream) {
      remoteStream = new MediaStream();
      console.log('Created new composite remote stream');
      
      // CRITICAL FOR MOBILE: Set srcObject AFTER adding event listeners
      // but DON'T set it yet - wait for tracks to be added first
      
      // Set up event listeners ONLY once when creating the stream
      remoteVideo.onloadedmetadata = () => {
        console.log('✅ Remote video metadata loaded:', {
          videoWidth: remoteVideo.videoWidth,
          videoHeight: remoteVideo.videoHeight,
          duration: remoteVideo.duration,
          readyState: remoteVideo.readyState
        });
        
        // Mobile: Try to play immediately when metadata loads
        if (isMobileDevice) {
          console.log('📱 Metadata loaded on mobile - attempting autoplay');
          remoteVideo.play()
            .then(() => console.log('📱 Autoplay successful after metadata'))
            .catch(err => {
              if (err.name !== 'AbortError') {
                console.log('📱 Autoplay after metadata failed:', err.message);
              }
            });
        }
      };
      
      remoteVideo.onloadeddata = () => {
        console.log('✅ Remote video data loaded');
      };
      
      remoteVideo.onplay = () => {
        console.log('✅ Remote video PLAY event fired');
      };
      
      remoteVideo.onplaying = () => {
        console.log('✅ Remote video PLAYING event fired (actually rendering)');
      };
      
      remoteVideo.onerror = (e) => {
        console.error('❌ Remote video ERROR:', e, remoteVideo.error);
      };
      
      remoteVideo.onstalled = () => {
        console.warn('Remote video STALLED');
      };
      
      remoteVideo.onwaiting = () => {
        console.warn('Remote video WAITING');
      };
    }
    
    // Add the new track to the composite stream
    remoteStream.addTrack(event.track);
    console.log('Added track to composite stream. Total tracks:', remoteStream.getTracks().length, {
      video: remoteStream.getVideoTracks().length,
      audio: remoteStream.getAudioTracks().length
    });
    
    // CRITICAL: Set srcObject AFTER adding tracks (especially important for mobile)
    if (isNewStream || !remoteVideo.srcObject) {
      remoteVideo.srcObject = remoteStream;
      console.log('✅ Set srcObject on remote video element');
    }
    
    // Show remote video container - AGGRESSIVE removal of hidden class
    remoteContainer.classList.remove('hidden');
    // Also remove any display: none that might be from Tailwind's hidden class
    remoteContainer.style.display = 'grid'; // Match grid container display
    remoteContainer.style.visibility = 'visible';
    remoteContainer.style.opacity = '1';
    console.log('Remote container shown for camera feed');
    
    // CRITICAL FOR MOBILE: Ensure the container and video element are properly visible
    if (isMobileDevice) {
      // Force show the remote container on mobile with !important-level inline styles
      remoteContainer.style.display = 'grid';
      remoteContainer.style.visibility = 'visible';
      remoteContainer.style.opacity = '1';
      remoteContainer.style.minHeight = '0'; // Let grid size it
      remoteContainer.style.maxHeight = 'none';
      remoteContainer.style.height = '100%';
      remoteContainer.style.flex = '1';
      remoteContainer.style.overflow = 'hidden';
      
      // Ensure video element is also visible
      remoteVideo.style.display = 'block';
      remoteVideo.style.visibility = 'visible';
      remoteVideo.style.opacity = '1';
      remoteVideo.style.width = '100%';
      remoteVideo.style.height = '100%';
      remoteVideo.style.objectFit = 'cover';
      
      console.log('📱 Mobile: Forced container and video visibility with flex sizing');
    }
    
    // Mobile-specific: Force video element refresh on track addition
    if (isMobileDevice) {
      console.log('📱 Mobile device detected - applying enhanced mobile video handling');
      
      // MOBILE FIX: Don't recreate stream, just reassign and force play
      // Recreating the stream can cause issues on some mobile browsers
      
      // Ensure all required attributes are set
      remoteVideo.autoplay = true;
      remoteVideo.playsinline = true;
      remoteVideo.playsInline = true;
      remoteVideo.muted = true; // Must be muted to avoid feedback
      remoteVideo.setAttribute('webkit-playsinline', 'true');
      remoteVideo.setAttribute('playsinline', 'true');
      remoteVideo.setAttribute('autoplay', 'true');
      remoteVideo.setAttribute('muted', 'true');
      
      // Force video element to be visible
      remoteVideo.style.display = 'block';
      remoteVideo.style.visibility = 'visible';
      remoteVideo.style.opacity = '1';
      remoteVideo.style.width = '100%';
      remoteVideo.style.height = '100%';
      remoteVideo.style.objectFit = 'cover';
      remoteVideo.style.backgroundColor = '#000';
      
      console.log('📱 Mobile video element configured:', {
        srcObject: !!remoteVideo.srcObject,
        readyState: remoteVideo.readyState,
        paused: remoteVideo.paused,
        videoTracks: remoteStream.getVideoTracks().length,
        videoTrackEnabled: remoteStream.getVideoTracks()[0]?.enabled,
        videoTrackReadyState: remoteStream.getVideoTracks()[0]?.readyState
      });
      
      // Multiple play attempts with increasing delays (mobile browsers can be slow)
      const attemptPlay = (delay) => {
        setTimeout(() => {
          if (remoteVideo.paused && remoteVideo.readyState >= 2) {
            remoteVideo.play()
              .then(() => console.log(`📱 Mobile remote video playing (attempt after ${delay}ms)`))
              .catch(err => {
                if (err.name !== 'AbortError') {
                  console.error(`📱 Mobile video play error (${delay}ms):`, err.name, err.message);
                }
              });
          }
        }, delay);
      };
      
      attemptPlay(0);
      attemptPlay(100);
      attemptPlay(300);
      attemptPlay(500);
      attemptPlay(1000);
      attemptPlay(2000);
    }
    
    // Check if stream has video tracks and if they are enabled
    const videoTracks = remoteStream.getVideoTracks();
    const hasVideoTrack = videoTracks.length > 0;
    const isVideoTrackEnabled = hasVideoTrack && videoTracks.some(t => t.enabled);
    
    console.log('Remote participant camera details:', {
      hasVideoTrack,
      isVideoTrackEnabled,
      trackCount: videoTracks.length,
      totalTracks: remoteStream.getTracks().length,
      streamId: event.streams[0].id
    });
    
    // CRITICAL: Use actual presence count instead of hardcoding to 2
    // This ensures we show the correct participant count when multiple peers are in the call
    if (channel && channel.state === 'joined') {
      const presenceList = new Presence(channel).list();
      const actualCount = presenceList ? Object.keys(presenceList).length : 1;
      console.log('Got remote track - actual presence count:', actualCount);
      updateParticipantDisplays(actualCount);
    } else {
      // Fallback to at least 2 if we received a remote track
      console.log('Channel not available, using minimum count of 2');
      updateParticipantDisplays(2);
    }
    
    if (hasVideoTrack && isVideoTrackEnabled) {
      remoteVideo.controls = false;
      
      // CRITICAL: Set video element properties for playback
      remoteVideo.autoplay = true;
      remoteVideo.playsinline = true;
      remoteVideo.muted = true;
      
      // Force video element to be visible
      remoteVideo.style.display = 'block';
      remoteVideo.style.visibility = 'visible';
      remoteVideo.style.opacity = '1';
      
      // Remove any existing placeholder
      const existingPlaceholder = remoteContainer.querySelector('.no-video-placeholder');
      if (existingPlaceholder) {
        existingPlaceholder.remove();
      }
      
      // If this is a video track being added, try to play
      if (event.track.kind === 'video') {
        console.log('Video track added, attempting to play...');
        
        // Mobile detection for enhanced handling
        const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        
        // Don't call load() on mobile - it can interfere with playback
        if (!isMobileDevice) {
          remoteVideo.load();
        }
        
        // Attempt to play immediately
        const playAttempt = () => {
          // Only try to play if we have a readyState >= HAVE_METADATA
          if (remoteVideo.readyState < HTMLMediaElement.HAVE_METADATA) {
            console.log('Media not ready yet (readyState:', remoteVideo.readyState, '), skipping play attempt');
            return;
          }
          
          remoteVideo.play()
            .then(() => {
              console.log('✅ Remote video playing successfully after track addition');
            })
            .catch(err => {
              // Only log non-AbortError errors - AbortError is normal when media isn't ready
              if (err.name !== 'AbortError') {
                console.error('❌ Failed to play remote video:', err.name, err.message);
              } else {
                console.log('ℹ️ Play attempt aborted (media not ready yet)');
              }
              
              // If autoplay failed due to permissions, wait for user interaction
              if (err.name === 'NotAllowedError') {
                console.log('Autoplay blocked, waiting for user interaction...');
                
                // For mobile, use both click and touchstart
                const playOnInteraction = () => {
                  console.log('User interaction detected, attempting to play remote video');
                  remoteVideo.play()
                    .then(() => console.log('✅ Video playing after user interaction'))
                    .catch(e => {
                      if (e.name !== 'AbortError') {
                        console.error('Still failed:', e);
                      }
                    });
                  document.removeEventListener('click', playOnInteraction);
                  document.removeEventListener('touchstart', playOnInteraction);
                };
                
                document.addEventListener('click', playOnInteraction, { once: true });
                document.addEventListener('touchstart', playOnInteraction, { once: true, passive: true });
                
                const message = isMobileDevice ? 'Tap anywhere to see remote video' : 'Click anywhere to see remote video';
                showToast(message, 3000);
              }
            });
        };
        
        // Set up event listener to play when metadata is ready
        remoteVideo.onloadedmetadata = () => {
          console.log('Remote video metadata loaded, attempting to play');
          playAttempt();
        };
        
        // Try to play immediately if already ready, and also after delays
        playAttempt();
        setTimeout(playAttempt, 100);
        setTimeout(playAttempt, 500);
        
        // Mobile: Additional delayed attempts
        if (isMobileDevice) {
          setTimeout(playAttempt, 1000);
          setTimeout(playAttempt, 2000);
        }
      }
      
    } else {
      // No video track or disabled video - show placeholder in remote container
      remoteVideo.srcObject = null;
      remoteVideo.style.display = 'none';
      
      if (!remoteContainer.querySelector('.no-video-placeholder')) {
        const placeholder = document.createElement('div');
        placeholder.className = 'no-video-placeholder absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl flex items-center justify-center';
        placeholder.innerHTML = `
          <div class="text-center text-white">
            <div class="w-20 h-20 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
              <svg class="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
              </svg>
            </div>
            <p class="text-lg font-semibold mb-1">Other Participant</p>
            <p class="text-sm text-gray-400">Camera is off</p>
            <div class="mt-3 flex items-center justify-center">
              <div class="w-3 h-3 bg-green-500 rounded-full animate-pulse mr-2"></div>
              <span class="text-xs text-gray-400">Audio only</span>
            </div>
          </div>
        `;
        remoteContainer.appendChild(placeholder);
      }
      
      console.log('Remote participant joined with camera disabled - showing in separate container');
    }
    
    // Force update grid immediately
    updateVideoGrid();
    
    // CRITICAL FOR MOBILE: Ensure remote container stays visible after grid update
    const isMobileUserAgent = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobileUserAgent) {
      const ensureRemoteVisible = () => {
        const remoteContainerElement = document.getElementById('remote-video-container');
        if (remoteContainerElement) {
          if (remoteContainerElement.classList.contains('hidden')) {
            console.log('📱 Mobile: Re-showing remote container (was hidden)');
            remoteContainerElement.classList.remove('hidden');
          }
          remoteContainerElement.style.display = 'grid';
          remoteContainerElement.style.visibility = 'visible';
          remoteContainerElement.style.opacity = '1';
          remoteContainerElement.style.minHeight = '0';
          remoteContainerElement.style.maxHeight = 'none';
          remoteContainerElement.style.height = '100%';
          remoteContainerElement.style.overflow = 'hidden';
        }
      };
      
      // Ensure visible immediately, after 50ms, 200ms, 500ms, and 1s
      ensureRemoteVisible();
      setTimeout(ensureRemoteVisible, 50);
      setTimeout(ensureRemoteVisible, 200);
      setTimeout(ensureRemoteVisible, 500);
      setTimeout(ensureRemoteVisible, 1000);
    }
    
    console.log('Remote participant setup complete in separate container:', {
      srcObject: !!remoteVideo.srcObject,
      hidden: remoteContainer.classList.contains('hidden'),
      hasVideoTrack,
      isVideoEnabled,
      containerClasses: remoteContainer.className
    });
    
    // If screen sharing is active, update the small participant videos
    const screenShareLayout = document.getElementById('screenshare-layout');
    if (screenShareLayout && !screenShareLayout.classList.contains('hidden')) {
      console.log('Screen share is active - updating remote camera in small view');
      
      // Multiple updates to ensure it shows on all devices
      setTimeout(() => {
        updateScreenShareParticipants();
      }, 100);
      
      // Additional update for mobile
      setTimeout(() => {
        updateScreenShareParticipants();
      }, 500);
      
      setTimeout(() => {
        updateScreenShareParticipants();
      }, 1000);
    }
    return;
  }

  // Remove fallback dynamic container creation since we want clear separation
  console.error('Remote video container not found - streams must be in separate containers');
}

function showScreenShareLayout() {
  console.log('Showing screen share layout');
  const defaultLayout = document.getElementById('videoplayer-wrapper');
  const screenShareLayout = document.getElementById('screenshare-layout');
  
  if (defaultLayout && screenShareLayout) {
    defaultLayout.classList.add('hidden');
    screenShareLayout.classList.remove('hidden');
    
    // Force update of participant videos in small view
    // This will show both local camera AND remote participant camera
    setTimeout(() => {
      console.log('Updating participant videos for screen share view');
      updateScreenShareParticipants();
    }, 100); // Small delay to ensure DOM is ready
    
    // Additional update after a bit more time for mobile
    setTimeout(() => {
      updateScreenShareParticipants();
    }, 500);
  } else {
    console.error('Layout elements not found:', { defaultLayout: !!defaultLayout, screenShareLayout: !!screenShareLayout });
  }
}

function hideScreenShareLayout() {
  console.log('Hiding screen share layout');
  const defaultLayout = document.getElementById('videoplayer-wrapper');
  const screenShareLayout = document.getElementById('screenshare-layout');
  
  if (defaultLayout && screenShareLayout) {
    screenShareLayout.classList.add('hidden');
    defaultLayout.classList.remove('hidden');
  }
}

function createCameraOffPlaceholder() {
  // Create a canvas for the camera off placeholder
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  
  // Draw gradient background
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#1f2937'); // gray-800
  gradient.addColorStop(1, '#111827'); // gray-900
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Draw user avatar circle
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2 - 20;
  const radius = 60;
  
  ctx.fillStyle = '#374151'; // gray-700
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.fill();
  
  // Draw user icon (simple representation)
  ctx.fillStyle = '#9ca3af'; // gray-400
  ctx.font = 'bold 40px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('👤', centerX, centerY - 10);
  
  // Draw "Camera is off" text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px Arial';
  ctx.fillText('Camera is off', centerX, centerY + 80);
  
  // Convert canvas to video stream
  const stream = canvas.captureStream(30); // 30 FPS
  return stream;
}

function createCustomCameraContent() {
  // Create a canvas for custom camera content during screen share - NO ANIMATION
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  
  // Convert canvas to video stream
  const stream = canvas.captureStream(1); // 1 FPS for static content
  return stream;
}

async function setupLocalMedia() {
  let audioAvailable = false;
  let videoAvailable = false;

  console.log('Attempting to get user media...');
  
  // Check if we're on mobile
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  console.log('Device type:', isMobile ? 'Mobile' : 'Desktop');
  
  // Check if getUserMedia is available
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.error('getUserMedia is not supported on this browser');
    localStream = new MediaStream();
    isVideoEnabled = false;
    setupPreview();
    updateStatusIndicators();
    updateMediaAvailability(false, false);
    showToast('Your browser does not support media access');
    return;
  }
  
  // Try to get both audio and video together first
  try {
    // On mobile, use more conservative constraints
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: isMobile ? {
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 24, max: 30 },
        facingMode: 'user'
      } : {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 30, max: 30 }
      }
    };
    
    console.log('Requesting media with constraints:', constraints);
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    audioAvailable = localStream.getAudioTracks().length > 0;
    videoAvailable = localStream.getVideoTracks().length > 0;
    
    console.log('Media access granted:', { audio: audioAvailable, video: videoAvailable });
    
  } catch (combinedError) {
    console.log('Combined media access failed:', combinedError.name, combinedError.message);
    
    // Fallback: Try audio only if camera fails
    try {
      console.log('Trying audio-only access...');
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      audioAvailable = true;
      videoAvailable = false;
      isVideoEnabled = false; // Update state immediately
      console.log('Audio-only access granted');
    } catch (audioError) {
      console.log('Audio-only access also failed:', audioError.name, audioError.message);
      
      // Last fallback: Try with minimal constraints
      try {
        console.log('Trying minimal constraints...');
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: isMobile ? { facingMode: 'user' } : true
        });
        audioAvailable = localStream.getAudioTracks().length > 0;
        videoAvailable = localStream.getVideoTracks().length > 0;
        console.log('Minimal constraints succeeded:', { audio: audioAvailable, video: videoAvailable });
      } catch (minimalError) {
        console.log('All media access attempts failed:', minimalError.name, minimalError.message);
        localStream = new MediaStream();
        audioAvailable = false;
        videoAvailable = false;
        isVideoEnabled = false;
        
        // Show a more helpful error message based on the error type
        if (minimalError.name === 'NotAllowedError' || minimalError.name === 'PermissionDeniedError') {
          showToast('Camera/microphone access denied. Please allow permissions in your browser settings.');
        } else if (minimalError.name === 'NotFoundError' || minimalError.name === 'DevicesNotFoundError') {
          showToast('No camera or microphone found on this device.');
        } else {
          showToast('Unable to access camera/microphone. You can still join the call without media.');
        }
      }
    }
  }

  // Store original video track if available
  if (videoAvailable && localStream.getVideoTracks().length > 0) {
    originalVideoTrack = localStream.getVideoTracks()[0];
    console.log('Original video track stored and enabled');
  }

  // Set initial audio state
  if (audioAvailable && localStream.getAudioTracks().length > 0) {
    localStream.getAudioTracks()[0].enabled = !isMuted;
  }

  console.log('Local media setup complete:', {
    audio: audioAvailable,
    video: videoAvailable,
    tracks: localStream.getTracks().length,
    isVideoEnabled
  });

  // Set up preview immediately
  setupPreview();
  updateStatusIndicators();
  updateMediaAvailability(audioAvailable, videoAvailable);
}

function setupPreview() {
  console.log('setupPreview called');
  updateLocalVideoDisplay();
  
  // Update grid layout after setting up local video
  setTimeout(() => {
    updateVideoGrid();
    debugVideoState();
  }, 100);
}

function updateMediaAvailability(audioAvailable, videoAvailable) {
  const muteBtn = document.getElementById('mute-btn');
  const videoBtn = document.getElementById('video-btn');
  const screenShareBtn = document.getElementById('screenshare-btn');
  
  // Disable buttons if media not available
  if (!audioAvailable && muteBtn) {
    muteBtn.disabled = true;
    muteBtn.classList.add('opacity-50', 'cursor-not-allowed');
    muteBtn.title = 'Microphone not available';
  }
  
  if (!videoAvailable && videoBtn) {
    videoBtn.disabled = true;
    videoBtn.classList.add('opacity-50', 'cursor-not-allowed');
    videoBtn.title = 'Camera not available';
  }
  
  // Screen sharing should always be available regardless of camera/mic access
  if (screenShareBtn) {
    screenShareBtn.disabled = false;
    screenShareBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    screenShareBtn.title = 'Share screen';
  }
}

function endCall() {
  console.log('Ending call and cleaning up resources...');
  
  // Set flag to prevent "Connection Failed" error
  isCallEnding = true;
  
  if (pc) {
    try {
      pc.close();
      pc = undefined;
    } catch (error) {
      console.error('Error closing peer connection:', error);
    }
  }
  
  if (localStream) {
    try {
      localStream.getTracks().forEach(track => track.stop());
      localStream = undefined;
    } catch (error) {
      console.error('Error stopping local stream:', error);
    }
  }
  
  if (screenShareStream) {
    try {
      screenShareStream.getTracks().forEach(track => track.stop());
      screenShareStream = undefined;
    } catch (error) {
      console.error('Error stopping screen share stream:', error);
    }
  }
  
  if (channel) {
    try {
      // Check if channel is still connected before attempting to leave
      if (channel.state === 'joined') {
        channel.leave();
      }
      channel = undefined;
    } catch (error) {
      console.error('Error leaving channel:', error);
      channel = undefined;
    }
  }
  
  // Clean up remote audio element
  if (remoteAudioElement) {
    try {
      if (remoteAudioElement.srcObject) {
        remoteAudioElement.srcObject.getTracks().forEach(track => track.stop());
      }
      remoteAudioElement.remove();
      remoteAudioElement = null;
      console.log('Remote audio element cleaned up');
    } catch (error) {
      console.error('Error cleaning up remote audio:', error);
    }
  }
  
  // Clean up remote stream
  if (remoteStream) {
    try {
      remoteStream.getTracks().forEach(track => track.stop());
      remoteStream = null;
      console.log('Remote stream cleaned up');
    } catch (error) {
      console.error('Error cleaning up remote stream:', error);
    }
  }
  
  isScreenSharing = false;
  localTracksAdded = false;
  
  console.log('Call cleanup completed');
  
  // Reset the flag after a short delay to allow connection state changes to settle
  setTimeout(() => {
    isCallEnding = false;
  }, 1000);
}

function forceShowRemoteVideo() {
  const remoteContainer = document.getElementById('remote-video-container');
  const remoteVideo = document.getElementById('videoplayer-remote');
  
  if (remoteContainer) {
    remoteContainer.classList.remove('hidden');
    remoteContainer.style.display = 'block';
    remoteContainer.style.visibility = 'visible';
    remoteContainer.style.opacity = '1';
  }
  
  if (remoteVideo) {
    remoteVideo.style.display = 'block';
    remoteVideo.style.visibility = 'visible';
    remoteVideo.style.opacity = '1';
    
    if (remoteVideo.srcObject && remoteVideo.paused) {
      remoteVideo.play().catch(console.log);
    }
  }
  
  updateVideoGrid();
  debugVideoState();
}

function toggleParticipantsPanel() {
  participantsPanelOpen = !participantsPanelOpen;
  
  if (participantsSidebar) {
    if (participantsPanelOpen) {
      participantsSidebar.classList.remove('hidden');
      setTimeout(() => {
        participantsSidebar.classList.remove('translate-x-full');
      }, 10);
    } else {
      participantsSidebar.classList.add('translate-x-full');
      setTimeout(() => {
        participantsSidebar.classList.add('hidden');
      }, 300);
    }
  }
}

function updateScreenShareParticipants() {
  const localVideoSmall = document.getElementById('videoplayer-local-small');
  const remoteVideoSmall = document.getElementById('videoplayer-remote-small');
  const remoteVideoSmallContainer = document.getElementById('remote-video-small');
  const remoteVideo = document.getElementById('videoplayer-remote');
  
  console.log('🔄 updateScreenShareParticipants called');
  
  // Set up event listeners for remote small video if not already done
  if (remoteVideoSmall && !remoteVideoSmall.hasAttribute('data-listeners-attached')) {
    console.log('📱 Setting up event listeners for remote small video');
    
    remoteVideoSmall.onloadedmetadata = () => {
      console.log('📱 Small video metadata loaded:', {
        width: remoteVideoSmall.videoWidth,
        height: remoteVideoSmall.videoHeight
      });
    };
    
    remoteVideoSmall.onloadeddata = () => {
      console.log('📱 Small video data loaded');
    };
    
    remoteVideoSmall.onplay = () => {
      console.log('📱 Small video PLAY event');
    };
    
    remoteVideoSmall.onplaying = () => {
      console.log('📱 Small video PLAYING (rendering frames)');
    };
    
    remoteVideoSmall.onerror = (e) => {
      console.error('📱 Small video ERROR:', e, remoteVideoSmall.error);
    };
    
    remoteVideoSmall.onstalled = () => {
      console.warn('📱 Small video STALLED');
    };
    
    remoteVideoSmall.setAttribute('data-listeners-attached', 'true');
  }
  
  // Update local video in small view - show original camera during screen sharing
  if (localVideoSmall) {
    let streamToShow = null;
    
    if (isScreenSharing && originalVideoTrack && originalVideoTrack.readyState === 'live' && isVideoEnabled) {
      // During screen share, show original camera in small view
      streamToShow = new MediaStream([originalVideoTrack]);
      console.log('Small view: showing original camera during screen share');
    } else if (localStream && localStream.getVideoTracks().length > 0 && isVideoEnabled) {
      streamToShow = localStream;
    }
    
    if (streamToShow) {
      localVideoSmall.srcObject = streamToShow;
      localVideoSmall.autoplay = true;
      localVideoSmall.playsinline = true;
      localVideoSmall.muted = true;
      localVideoSmall.play().catch(e => console.log('Local small video play failed:', e));
    } else {
      // Show placeholder in small view too
      localVideoSmall.srcObject = null;
    }
  }
  
  // Update remote video in small view if participant exists
  if (remoteVideoSmall && remoteVideoSmallContainer) {
    const remoteContainer = document.getElementById('remote-video-container');
    const hasRemoteParticipant = remoteContainer && !remoteContainer.classList.contains('hidden');
    
    // Check if we have a remote stream with video tracks
    const hasRemoteVideo = remoteStream && remoteStream.getVideoTracks().length > 0;
    const remoteVideoTracks = remoteStream ? remoteStream.getVideoTracks() : [];
    const hasEnabledVideoTrack = remoteVideoTracks.some(track => track.enabled && track.readyState === 'live');
    
    console.log('📺 Screen share - updating remote participant small view:', {
      hasRemoteParticipant,
      hasRemoteVideo,
      hasEnabledVideoTrack,
      remoteStreamExists: !!remoteStream,
      totalTracks: remoteStream ? remoteStream.getTracks().length : 0,
      videoTracks: remoteVideoTracks.length,
      videoTrackDetails: remoteVideoTracks.map(t => ({
        id: t.id,
        label: t.label,
        enabled: t.enabled,
        readyState: t.readyState,
        muted: t.muted
      }))
    });
    
    if (hasRemoteVideo && hasEnabledVideoTrack) {
      console.log('✅ Showing remote participant camera in small view');
      
      // Mobile detection for special handling
      const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      
      // For mobile, recreate the stream to force recognition
      if (isMobileDevice) {
        console.log('📱 Mobile: Recreating stream for small view');
        const tracks = remoteStream.getTracks();
        const newSmallStream = new MediaStream(tracks);
        remoteVideoSmall.srcObject = newSmallStream;
      } else {
        // Desktop: Just assign the stream
        remoteVideoSmall.srcObject = remoteStream;
      }
      
      // Show remote participant's camera in small view during screen share
      remoteVideoSmall.autoplay = true;
      remoteVideoSmall.playsinline = true;
      remoteVideoSmall.muted = true; // Muted in small view (audio plays from audio element)
      
      // Force mobile attributes
      remoteVideoSmall.setAttribute('playsinline', 'true');
      remoteVideoSmall.setAttribute('webkit-playsinline', 'true');
      remoteVideoSmall.playsInline = true;
      
      // Set video element to be visible
      remoteVideoSmall.style.display = 'block';
      remoteVideoSmall.style.visibility = 'visible';
      remoteVideoSmall.style.opacity = '1';
      
      // Show the container
      remoteVideoSmallContainer.classList.remove('hidden');
      remoteVideoSmallContainer.style.display = 'block';
      
      console.log('📱 Container classes after showing:', remoteVideoSmallContainer.className);
      
      // Multiple play attempts for reliability (especially on mobile)
      const playSmallVideo = (attempt) => {
        remoteVideoSmall.play()
          .then(() => console.log(`✅ Remote small video playing (attempt ${attempt})`))
          .catch(e => console.log(`⚠️ Remote small video play failed (attempt ${attempt}):`, e.message));
      };
      
      playSmallVideo(1);
      setTimeout(() => playSmallVideo(2), 100);
      setTimeout(() => playSmallVideo(3), 300);
      setTimeout(() => playSmallVideo(4), 500);
      setTimeout(() => playSmallVideo(5), 1000);
      setTimeout(() => playSmallVideo(6), 2000);
      
      // Update the name label for remote participant
      const remoteNameSmall = document.getElementById('remote-participant-name-small');
      if (remoteNameSmall) {
        remoteNameSmall.textContent = 'Participant';
      }
      
      console.log('✅ Remote participant camera configured for small view during screen share');
    } else {
      console.log('❌ No remote video or disabled - hiding small view:', {
        hasRemoteVideo,
        hasEnabledVideoTrack
      });
      remoteVideoSmallContainer.classList.add('hidden');
      remoteVideoSmallContainer.style.display = 'none';
    }
  } else {
    console.log('⚠️ Small video elements not found:', {
      remoteVideoSmall: !!remoteVideoSmall,
      remoteVideoSmallContainer: !!remoteVideoSmallContainer
    });
  }
}

// Add function to switch between different custom camera modes
function switchCustomCameraMode(mode = 'animated') {
  if (!isScreenSharing) return;
  
  // Stop current custom stream
  if (customCameraStream) {
    customCameraStream.getTracks().forEach(track => track.stop());
  }
  
  switch (mode) {
    case 'animated':
      customCameraStream = createCustomCameraContent();
      break;
    case 'placeholder':
      customCameraStream = createCameraOffPlaceholder();
      break;
    case 'logo':
      // You could create a stream with your logo here
      customCameraStream = createCustomCameraContent(); // Fallback for now
      break;
    default:
      customCameraStream = createCustomCameraContent();
  }
  
  updateLocalVideoDisplay();
  updateScreenShareParticipants();
}

function updateVideoGrid() {
  if (!videoPlayerWrapper) return;
  
  // Get container references
  const remoteContainer = document.getElementById('remote-video-container');
  const localContainer = document.getElementById('local-video-container');
  const remoteVideo = document.getElementById('videoplayer-remote');
  
  const isMobile = window.innerWidth < 768;
  console.log('📱 updateVideoGrid START - isMobile:', isMobile, 'viewport width:', window.innerWidth);
  
  // Check for presence count and remote container state
  const presenceElement = document.getElementById('viewercount');
  let participantCount = presenceElement ? parseInt(presenceElement.textContent) || 1 : 1;
  
  // Check if remote container is visible (not hidden)
  const remoteContainerVisible = remoteContainer && !remoteContainer.classList.contains('hidden');
  
  // Check if we have a remote stream OR placeholder (indicating a remote participant)
  const hasRemoteContent = remoteVideo && (
    remoteVideo.srcObject || 
    remoteContainer?.querySelector('.no-video-placeholder')
  );
  
  console.log('Grid update - checking conditions:', {
    participantCount,
    remoteContainerVisible,
    hasRemoteContent,
    remoteHidden: remoteContainer?.classList.contains('hidden'),
    remoteSrcObject: !!remoteVideo?.srcObject,
    hasPlaceholder: !!remoteContainer?.querySelector('.no-video-placeholder')
  });
  
  // If we have remote content but participant count is 1, query actual presence
  if (hasRemoteContent && participantCount < 2) {
    console.log('Detected remote content, querying actual presence count');
    if (channel && channel.state === 'joined') {
      const presenceList = new Presence(channel).list();
      const actualCount = presenceList ? Object.keys(presenceList).length : 1;
      participantCount = Math.max(actualCount, 2); // At least 2 if we have remote content
      console.log('Updated participant count from presence:', actualCount, 'Using:', participantCount);
      updateParticipantDisplays(participantCount);
    } else {
      // Fallback: use at least 2 if we have remote content
      participantCount = 2;
      console.log('Channel not available, using minimum count of 2 for remote content');
      updateParticipantDisplays(2);
    }
  }
  
  // Force clear separation: local always shows, remote shows if we have content OR 2+ participants
  const hasLocalVideo = !!localContainer;
  const shouldShowRemote = participantCount > 1 || hasRemoteContent;
  
  // If we should show remote but container is hidden, force show it
  if (shouldShowRemote && remoteContainer && remoteContainer.classList.contains('hidden')) {
    console.log('Force showing remote container - participant count:', participantCount, 'hasRemoteContent:', hasRemoteContent);
    remoteContainer.classList.remove('hidden');
    
    // Extra force-show on mobile
    const isMobileUserAgent = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobileUserAgent) {
      remoteContainer.style.display = 'block';
      remoteContainer.style.visibility = 'visible';
      remoteContainer.style.opacity = '1';
      console.log('📱 Mobile: Extra force-show for remote container');
    }
  }
  
  // Hide remote container only if we definitely don't have remote participants
  if (remoteContainer && participantCount <= 1 && !hasRemoteContent) {
    if (!remoteContainer.classList.contains('hidden')) {
      console.log('Force hiding remote container - no remote participants or content');
      remoteContainer.classList.add('hidden');
      
      if (remoteVideo) {
        remoteVideo.srcObject = null;
        remoteVideo.style.display = 'none';
      }
      
      // Remove any placeholders
      const placeholder = remoteContainer.querySelector('.no-video-placeholder');
      if (placeholder) {
        placeholder.remove();
      }
    }
  }
  
  // Determine if remote container should be visible after all checks
  const hasRemoteParticipant = shouldShowRemote && 
    remoteContainer && 
    !remoteContainer.classList.contains('hidden');
  
  // Count total visible videos/containers
  const totalVideoCount = hasRemoteParticipant ? 2 : 1;
  
  console.log('Grid update with participant-based layout:', { 
    hasLocalVideo, 
    hasRemoteParticipant, 
    totalVideoCount,
    participantCount,
    shouldShowRemote,
    hasRemoteContent,
    localContainer: !!localContainer,
    remoteContainer: !!remoteContainer,
    remoteHidden: remoteContainer?.classList.contains('hidden'),
    remoteSrcObject: !!remoteVideo?.srcObject,
    remoteHasPlaceholder: !!remoteContainer?.querySelector('.no-video-placeholder')
  });

  // Responsive grid classes based on actual participant count
  let gridClasses;
  
  if (totalVideoCount === 1) {
    // Only local video - full width
    gridClasses = 'grid-cols-1 grid-rows-1';
  } else if (totalVideoCount === 2) {
    // Both local and remote
    if (isMobile) {
      // On mobile: 1 column, 2 rows stacked vertically
      gridClasses = 'grid-cols-1 grid-rows-2';
    } else {
      // On desktop: 2 columns side by side
      gridClasses = 'grid-cols-2 grid-rows-1';
    }
  } else {
    // Fallback for more participants
    gridClasses = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
  }

  // Apply responsive padding and sizing
  const padding = isMobile ? 'p-2' : 'p-4 lg:p-6';
  const gap = isMobile ? 'gap-2' : 'gap-3 lg:gap-4';
  
  // Update wrapper classes - use only valid Tailwind classes
  // IMPORTANT: Remove flex classes and use grid
  const baseClasses = `absolute inset-0 ${padding} ${gap} ${gridClasses}`;
  const newClassName = baseClasses.replace(/flex[\s-]\S*/g, '').replace(/\s+/g, ' ').trim() + ' grid';
  
  if (videoPlayerWrapper.className !== newClassName) {
    videoPlayerWrapper.className = newClassName;
    console.log('Updated wrapper classes for participant-based layout:', newClassName);
  }
  
  // CRITICAL FOR MOBILE: On mobile with 2 participants, override grid row sizing with inline styles
  if (isMobile && totalVideoCount === 2) {
    // Use inline styles to force 2 equal-height rows on mobile
    videoPlayerWrapper.style.gridTemplateRows = '1fr 1fr';
    videoPlayerWrapper.style.gridTemplateColumns = '1fr';
    videoPlayerWrapper.style.display = 'grid';
    videoPlayerWrapper.style.height = '100%';
    videoPlayerWrapper.style.width = '100%';
    videoPlayerWrapper.style.alignContent = 'stretch';
    videoPlayerWrapper.style.justifyContent = 'stretch';
    videoPlayerWrapper.style.gap = '0.5rem'; // Small gap for visual separation
    console.log('📱 Mobile 2-participant: Set inline gridTemplateRows = 1fr 1fr, gridTemplateColumns = 1fr');
  } else if (isMobile && totalVideoCount === 1) {
    // Single participant - full height
    videoPlayerWrapper.style.gridTemplateRows = '1fr';
    videoPlayerWrapper.style.gridTemplateColumns = '1fr';
    videoPlayerWrapper.style.display = 'grid';
    videoPlayerWrapper.style.height = '100%';
    videoPlayerWrapper.style.width = '100%';
    videoPlayerWrapper.style.alignContent = 'stretch';
    videoPlayerWrapper.style.justifyContent = 'stretch';
    console.log('📱 Mobile 1-participant: Set inline gridTemplateRows = 1fr');
  } else {
    // Desktop - let Tailwind handle it, but still set display grid
    videoPlayerWrapper.style.gridTemplateRows = '';
    videoPlayerWrapper.style.gridTemplateColumns = '';
    videoPlayerWrapper.style.display = 'grid';
    videoPlayerWrapper.style.height = '100%';
    videoPlayerWrapper.style.width = '100%';
    videoPlayerWrapper.style.alignContent = 'stretch';
    videoPlayerWrapper.style.justifyContent = 'stretch';
    console.log('Desktop: Clearing inline template overrides, using Tailwind responsive');
  }
  
  // Ensure proper sizing for containers - ONLY process containers that should be visible
  [localContainer, remoteContainer].forEach((container, index) => {
    if (!container) return;
    
    const isLocal = container === localContainer;
    const isRemote = container === remoteContainer;
    
    // CRITICAL FOR MOBILE: Force both containers into the grid when we have 2 participants
    if (isMobile && totalVideoCount === 2) {
      // AGGRESSIVELY remove hidden class
      if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        console.log('📱 Mobile 2-video: FORCE removed hidden class from', isLocal ? 'LOCAL' : 'REMOTE');
      }
      // Force container to be a grid child
      container.style.display = 'block'; // Grid children should be block
      container.style.visibility = 'visible';
      container.style.opacity = '1';
    }
    
    // CRITICAL: Only process containers that should be visible
    if (isLocal || (isRemote && hasRemoteParticipant) || (isMobile && totalVideoCount === 2 && isRemote)) {
      const video = container.querySelector('video');
      const placeholder = container.querySelector('.no-video-placeholder');
      
      // Ensure container is visible
      container.style.visibility = 'visible';
      container.style.opacity = '1';
      
      if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        console.log('Removed hidden class from', isLocal ? 'local' : 'remote', 'container');
      }
      
      // Set container dimensions based on participant count
      if (totalVideoCount === 1) {
        container.style.minHeight = isMobile ? '50vh' : '60vh';
        container.style.maxHeight = '100%';
        container.style.height = 'auto';
        container.style.gridRow = 'auto';
        container.style.gridColumn = 'auto';
        container.style.flex = 'none';
        container.style.display = 'block';
      } else if (totalVideoCount === 2) {
        if (isMobile) {
          // On mobile with 2 participants, each container takes 1 grid row (50% each via 1fr 1fr)
          container.style.minHeight = '0'; // Allow grid to shrink below minHeight
          container.style.maxHeight = 'none';
          container.style.height = '100%'; // Take full height of grid cell
          container.style.width = '100%'; // Take full width
          container.style.flex = 'none'; // Don't use flex, let grid handle it
          container.style.overflow = 'hidden';
          container.style.display = 'block'; // Ensure display is block for grid positioning
          console.log('📱 Mobile 2-participant container:', isLocal ? 'LOCAL' : 'REMOTE', '- Using grid sizing (100% height)');
        } else {
          container.style.minHeight = '50vh';
          container.style.maxHeight = '100%';
          container.style.height = 'auto';
          container.style.width = '100%';
          container.style.gridRow = 'auto';
          container.style.gridColumn = 'auto';
          container.style.flex = 'none';
          container.style.display = 'block';
        }
      }
      
      // Ensure video element properties
      if (video && video.srcObject) {
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.style.display = 'block';
        video.style.visibility = 'visible';
        video.style.opacity = '1';
        
        // Ensure proper z-index and positioning for mobile
        const isMobileUserAgent = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobileUserAgent) {
          video.style.position = 'relative';
          video.style.zIndex = isLocal ? '10' : '5';
          console.log('📱 Mobile video styling:', {
            isLocal,
            display: video.style.display,
            visibility: video.style.visibility,
            zIndex: video.style.zIndex
          });
        }
        
        // Ensure video is playing
        if (video.paused && video.readyState >= 2) {
          video.play().catch(e => {
            console.log('Video play failed during grid update:', e);
          });
        }
      }
      
      // CRITICAL FOR MOBILE: Queue a check to ensure remote container stays visible
      if (isRemote && isMobile) {
        setTimeout(() => {
          const checkContainer = document.getElementById('remote-video-container');
          if (checkContainer && checkContainer.style.display === 'none') {
            console.log('📱 MOBILE: Detected remote container was hidden, forcing it back to visible');
            checkContainer.style.display = 'block';
            checkContainer.style.visibility = 'visible';
            checkContainer.style.opacity = '1';
          }
        }, 10);
      }
    } else if (isRemote && !hasRemoteParticipant) {
      // CRITICAL: For remote container that should NOT be visible, completely hide it
      console.log('Completely hiding remote container - not needed');
      container.style.display = 'none';
      container.style.visibility = 'hidden';
      container.style.opacity = '0';
      container.style.minHeight = '';
      container.style.maxHeight = '';
      
      // Ensure it has hidden class
      if (!container.classList.contains('hidden')) {
        container.classList.add('hidden');
      }
    }
  });
  
  console.log('Grid update complete with participant-based layout:', { 
    totalVideoCount, 
    participantCount,
    isMobile, 
    gridClasses,
    localVisible: hasLocalVideo,
    remoteVisible: hasRemoteParticipant
  });
  
  // FINAL SAFETY CHECK FOR MOBILE: If we have 2 videos on mobile, ensure remote is NOT hidden
  if (isMobile && totalVideoCount === 2 && remoteContainer) {
    setTimeout(() => {
      if (remoteContainer.classList.contains('hidden')) {
        console.log('📱 FINAL CHECK: Remote container was hidden! Force showing it now');
        remoteContainer.classList.remove('hidden');
        remoteContainer.style.display = 'block';
        remoteContainer.style.visibility = 'visible';
        remoteContainer.style.opacity = '1';
      }
    }, 100);
  }
}

function updateParticipantDisplays(count) {
  // Update the header count
  if (peerCount) {
    peerCount.textContent = count.toString();
  }
  
  // Update the floating participant count
  const totalParticipants = document.getElementById('total-participants');
  if (totalParticipants) {
    totalParticipants.textContent = count === 1 ? '1 participant' : `${count} participants`;
  }
  
  console.log('Updated all participant displays to:', count);
}

function updateParticipantCount() {
  // This function is now simplified since presence handles the real-time updates
  const presenceElement = document.getElementById('viewercount');
  const totalParticipantsElement = document.getElementById('total-participants');
  
  let count = 1; // Default fallback
  
  // Check if we have presence data in the DOM
  if (presenceElement && presenceElement.textContent) {
    const presenceCount = parseInt(presenceElement.textContent);
    if (!isNaN(presenceCount) && presenceCount > 0) {
      count = presenceCount;
    }
  }
  
  // Fallback: count based on visible video containers
  if (count === 1) {
    const remoteContainer = document.getElementById('remote-video-container');
    const hasRemoteParticipant = remoteContainer && !remoteContainer.classList.contains('hidden');
    if (hasRemoteParticipant) {
      count = 2;
    }
  }
  
  console.log('Manual participant count update:', count);
  
  // Update displays
  updateParticipantDisplays(count);
}

// Initialize DOM elements after mount
function initializeDOMElements() {
  localVideoPlayer = document.getElementById('videoplayer-local');
  videoPlayerWrapper = document.getElementById('videoplayer-wrapper');
  peerCount = document.getElementById('viewercount');
  connectionStatus = document.getElementById('connection-status');
  localMuteIndicator = document.getElementById('local-mute-indicator');
  localVideoIndicator = document.getElementById('local-video-indicator');
  meetingTime = document.getElementById('meeting-time');
  participantsSidebar = document.getElementById('participants-sidebar');
  
  console.log('DOM elements initialized:', {
    localVideoPlayer: !!localVideoPlayer,
    videoPlayerWrapper: !!videoPlayerWrapper,
    peerCount: !!peerCount,
    connectionStatus: !!connectionStatus,
    meetingTime: !!meetingTime,
    participantsSidebar: !!participantsSidebar
  });
}

async function debugVideoState() {
  const remoteContainer = document.getElementById('remote-video-container');
  const remoteVideo = document.getElementById('videoplayer-remote');
  const localVideo = document.getElementById('videoplayer-local');
  const localContainer = document.getElementById('local-video-container');
  
  console.log('=== DETAILED Video Debug State ===');
  console.log('LOCAL VIDEO STATE:');
  console.log('- Container exists:', !!localContainer);
  console.log('- Container hidden:', localContainer?.classList.contains('hidden'));
  console.log('- Video element exists:', !!localVideo);
  console.log('- Video srcObject:', !!localVideo?.srcObject);
  console.log('- Video display style:', localVideo?.style.display);
  console.log('- Video visibility style:', localVideo?.style.visibility);
  console.log('- Video opacity style:', localVideo?.style.opacity);
  console.log('- Video readyState:', localVideo?.readyState);
  console.log('- Video paused:', localVideo?.paused);
  console.log('- Video dimensions:', {
    videoWidth: localVideo?.videoWidth,
    videoHeight: localVideo?.videoHeight,
    clientWidth: localVideo?.clientWidth,
    clientHeight: localVideo?.clientHeight
  });
  console.log('- Local stream tracks:', localStream?.getTracks().map(t => ({
    kind: t.kind,
    enabled: t.enabled,
    readyState: t.readyState,
    label: t.label
  })));
  
  console.log('STATE FLAGS:');
  console.log('- isVideoEnabled:', isVideoEnabled);
  console.log('- hasLocalStream:', !!localStream);
  console.log('- videoTrackCount:', localStream?.getVideoTracks().length || 0);
  console.log('- videoTrackEnabled:', localStream?.getVideoTracks()[0]?.enabled);
  
  console.log('CONTAINER STYLING:');
  console.log('- Container classes:', localContainer?.className);
  console.log('- Video classes:', localVideo?.className);
  console.log('- Has placeholder:', !!localContainer?.querySelector('.no-video-placeholder'));
  console.log('=======================================');
}

export const Home = {
  async mounted() {
    console.log('🚀 ========== HOME HOOK MOUNTED ==========');
    console.log('Current URL:', window.location.href);
    console.log('==========================================');
    
    // CRITICAL: Initialize DOM elements first
    initializeDOMElements();
    
    // Check security context (HTTPS required for getUserMedia on mobile)
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || 
                       hostname === '127.0.0.1' || 
                       hostname === '[::1]' ||
                       hostname.endsWith('.localhost');
    
    console.log('Security context:', {
      isSecureContext: window.isSecureContext,
      protocol: window.location.protocol,
      hostname: hostname,
      isLocalhost: isLocalhost
    });
    
    // Warn if not in secure context and not localhost
    if (!window.isSecureContext && !isLocalhost) {
      console.warn('WARNING: Not in secure context. Camera/microphone access requires HTTPS.');
      const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      
      if (isMobileDevice) {
        showToast('⚠️ Camera access requires HTTPS or localhost. For mobile testing, use port forwarding or ngrok.', 6000);
      } else {
        showToast('⚠️ Camera access requires HTTPS. For testing, access via localhost or 127.0.0.1', 5000);
      }
    }
    
    // Start meeting timer
    meetingStartTime = new Date();
    startMeetingTimer();
    
    // Setup UI event listeners first
    setupUIEventListeners();
    
    // Check if we're on mobile and show permission helper
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      console.log('Mobile device detected, showing permission helper');
      showMobilePermissionHelper();
    }
    
    // Initialize WebRTC and media in correct order
    await createPeerConnection();
    await setupLocalMedia(); // This must complete before joining channel
    
    // Hide mobile permission helper after media setup
    if (isMobile) {
      hideMobilePermissionHelper();
    }
    
    // Join channel after media is set up
    await joinChannel();
    
    // Initialize status indicators
    const micStatus = document.getElementById('local-mic-status');
    const cameraStatus = document.getElementById('local-camera-status');
    
    // Set microphone indicator
    if (micStatus) {
      if (isMuted) {
        micStatus.className = 'flex items-center space-x-2 bg-red-500/90 backdrop-blur-sm rounded-lg px-3 py-2 transition-all duration-300 shadow-lg';
        micStatus.innerHTML = '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clip-rule="evenodd"></path>' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path>' +
          '</svg>' +
          '<span class="text-white text-xs font-semibold">MUTED</span>';
      } else {
        micStatus.className = 'flex items-center space-x-2 bg-blue-500/90 backdrop-blur-sm rounded-lg px-3 py-2 transition-all duration-300 shadow-lg';
        micStatus.innerHTML = '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>' +
          '</svg>' +
          '<span class="text-white text-xs font-semibold">ON</span>';
      }
    }
    
    // Set camera indicator
    if (cameraStatus) {
      if (isVideoEnabled) {
        cameraStatus.className = 'flex items-center space-x-2 bg-blue-500/90 backdrop-blur-sm rounded-lg px-3 py-2 transition-all duration-300 shadow-lg';
        cameraStatus.innerHTML = '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>' +
          '</svg>' +
          '<span class="text-white text-xs font-semibold">ON</span>';
      } else {
        cameraStatus.className = 'flex items-center space-x-2 bg-red-500/90 backdrop-blur-sm rounded-lg px-3 py-2 transition-all duration-300 shadow-lg';
        cameraStatus.innerHTML = '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
          '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>' +
          '<line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="4" y1="4" x2="20" y2="20"></line>' +
          '</svg>' +
          '<span class="text-white text-xs font-semibold">OFF</span>';
      }
    }
    
    // Initial UI updates
    updateParticipantCount();
    updateStatusIndicators();
    updateVideoGrid();
    
    // Add resize listener to maintain proper layout on orientation change
    window.addEventListener('resize', () => {
      console.log('📱 Window resized, updating video grid');
      setTimeout(() => updateVideoGrid(), 100);
    });
    
    // Periodic updates
    setInterval(() => {
      updateParticipantCount();
    }, 10000);
    
    // Additional grid update after everything is initialized
    setTimeout(() => {
      console.log('📱 Post-initialization grid update');
      updateVideoGrid();
    }, 500);
    
    // Expose functions globally for LiveView integration
    window.callControls = {
      toggleMute,
      toggleVideo,
      toggleScreenShare,
      startScreenShare,
      stopScreenShare,
      endCall,
      toggleParticipantsPanel,
      switchCustomCameraMode,
      retryConnection: async () => {
        hideError();
        await this.mounted();
      },
      debugVideoState,
      forceShowRemoteVideo,
      // Debug function to check connection status
      debugConnection: () => {
        console.log('========== CONNECTION DEBUG INFO ==========');
        console.log('Peer Connection State:', pc?.connectionState);
        console.log('ICE Connection State:', pc?.iceConnectionState);
        console.log('Signaling State:', pc?.signalingState);
        console.log('Local Stream:', {
          exists: !!localStream,
          tracks: localStream?.getTracks().map(t => ({
            kind: t.kind,
            enabled: t.enabled,
            readyState: t.readyState,
            label: t.label
          }))
        });
        console.log('Local Tracks Added to PC:', localTracksAdded);
        console.log('Senders:', pc?.getSenders().map(s => ({
          track: s.track ? {kind: s.track.kind, enabled: s.track.enabled} : null
        })));
        console.log('Receivers:', pc?.getReceivers().map(r => ({
          track: r.track ? {kind: r.track.kind, id: r.track.id} : null
        })));
        console.log('Channel State:', channel?.state);
        console.log('==========================================');
      }
    };
  },

  updated() {
    console.log('📱 LIVEVIEW UPDATED - Re-checking grid and remote participant visibility');
    
    // After any LiveView update (e.g., toggle_mute, toggle_video), re-check the grid
    // This ensures remote participants don't disappear when toggling media
    setTimeout(() => {
      updateVideoGrid();
      
      // Also ensure remote container is visible if we have participants
      const presenceElement = document.getElementById('viewercount');
      const participantCount = presenceElement ? parseInt(presenceElement.textContent) || 1 : 1;
      
      if (participantCount > 1) {
        const remoteContainer = document.getElementById('remote-video-container');
        if (remoteContainer && remoteContainer.classList.contains('hidden')) {
          console.log('🔧 After LiveView update: Remote container was hidden, force showing it');
          remoteContainer.classList.remove('hidden');
          remoteContainer.style.display = 'block';
          remoteContainer.style.visibility = 'visible';
          remoteContainer.style.opacity = '1';
          
          // Re-run grid update to ensure proper layout
          setTimeout(() => updateVideoGrid(), 50);
        }
      }
    }, 100);
  },
  
  destroyed() {
    if (meetingTimer) {
      clearInterval(meetingTimer);
      meetingTimer = null;
    }
    
    endCall();
  }
};

function updateLocalVideoDisplay() {
  if (!localVideoPlayer) {
    console.error('Local video player element not found');
    return;
  }
  
  const localContainer = document.getElementById('local-video-container');
  if (!localContainer) {
    console.error('Local video container not found');
    return;
  }
  
  const placeholder = localContainer.querySelector('.no-video-placeholder');
  
  console.log('updateLocalVideoDisplay called:', {
    isVideoEnabled,
    hasLocalStream: !!localStream,
    hasVideoTracks: localStream?.getVideoTracks().length || 0,
    videoTrackEnabled: localStream?.getVideoTracks()[0]?.enabled,
    isScreenSharing,
    hasOriginalVideoTrack: !!originalVideoTrack
  });
  
  // Determine what to show
  let streamToShow = null;
  let showPlaceholder = false;
  
  // CRITICAL: Always show original camera during screen sharing
  if (isScreenSharing && originalVideoTrack && originalVideoTrack.readyState === 'live' && isVideoEnabled) {
    // During screen share, show original camera track
    streamToShow = new MediaStream([originalVideoTrack]);
    console.log('Screen sharing: showing original camera stream');
  } else if (isVideoEnabled && localStream && localStream.getVideoTracks().length > 0) {
    // Show normal camera when enabled and available
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack && videoTrack.readyState === 'live') {
      streamToShow = localStream;
      console.log('Showing normal camera stream');
    } else {
      showPlaceholder = true;
      console.log('Video track not ready, showing placeholder');
    }
  } else {
    // Show placeholder - camera off or no camera available
    showPlaceholder = true;
    console.log('No video or disabled - showing placeholder');
  }
  
  if (showPlaceholder) {
    // Hide video and show placeholder
    localVideoPlayer.style.display = 'none';
    localVideoPlayer.srcObject = null;
    
    if (!placeholder) {
      const newPlaceholder = document.createElement('div');
      newPlaceholder.className = 'no-video-placeholder absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl flex items-center justify-center z-10';
      newPlaceholder.innerHTML = '<div class="text-center text-white">' +
        '<div class="w-20 h-20 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">' +
          '<svg class="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3l18 18"></path>' +
          '</svg>' +
        '</div>' +
        '<p class="text-lg font-semibold mb-1">You</p>' +
        '<p class="text-sm text-gray-400">Camera is off</p>' +
        (isScreenSharing ? '<p class="text-xs text-blue-400 mt-2">🖥️ Screen sharing active</p>' : '') +
        '</div>';
      localContainer.appendChild(newPlaceholder);
      console.log('Created new placeholder for local video');
    }
    placeholder.style.display = 'flex';
  } else {
    // Show video and hide placeholder
    if (placeholder) {
      placeholder.style.display = 'none';
    }
    
    // Configure video element
    localVideoPlayer.style.display = 'block';
    localVideoPlayer.style.visibility = 'visible';
    localVideoPlayer.style.opacity = '1';
    localVideoPlayer.style.width = '100%';
    localVideoPlayer.style.height = '100%';
    localVideoPlayer.style.objectFit = 'cover';
    
    // Set the stream
    localVideoPlayer.srcObject = streamToShow;
    localVideoPlayer.autoplay = true;
    localVideoPlayer.playsinline = true;
    localVideoPlayer.muted = true;
    
    // Play the video
    localVideoPlayer.play().then(() => {
      console.log('Local video playing successfully');
    }).catch(e => {
      console.error('Local video play failed:', e);
    });
  }
}

function toggleVideo() {
  console.log('toggleVideo called - current state:', {
    isVideoEnabled,
    hasLocalStream: !!localStream,
    videoTracks: localStream?.getVideoTracks().length || 0
  });
  
  if (!localStream || localStream.getVideoTracks().length === 0) {
    // If no camera available, still toggle state for UI
    isVideoEnabled = !isVideoEnabled;
    console.log('No video tracks available, toggled state to:', isVideoEnabled);
    updateStatusIndicators();
    updateLocalVideoDisplay();
    showToast(isVideoEnabled ? 'Camera would be on (not available)' : 'Camera off');
    return;
  }

  const videoTrack = localStream.getVideoTracks()[0];
  
  // Toggle the state
  isVideoEnabled = !isVideoEnabled;
  
  // Apply to track
  if (videoTrack && videoTrack.readyState !== 'ended') {
    videoTrack.enabled = isVideoEnabled;
    console.log('Video track toggled:', {
      isVideoEnabled,
      trackEnabled: videoTrack.enabled
    });
  }
  
  updateStatusIndicators();
  updateLocalVideoDisplay();
  
  // Update visual camera indicator
  const cameraStatus = document.getElementById('local-camera-status');
  if (cameraStatus) {
    if (isVideoEnabled) {
      // Camera ON - blue background
      cameraStatus.className = 'flex items-center space-x-2 bg-blue-500/90 backdrop-blur-sm rounded-lg px-3 py-2 transition-all duration-300 shadow-lg animate-pulse';
      cameraStatus.innerHTML = '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>' +
        '</svg>' +
        '<span class="text-white text-xs font-semibold">ON</span>';
      // Remove pulse animation after 1 second
      setTimeout(() => {
        if (cameraStatus && isVideoEnabled) {
          cameraStatus.className = 'flex items-center space-x-2 bg-blue-500/90 backdrop-blur-sm rounded-lg px-3 py-2 transition-all duration-300 shadow-lg';
        }
      }, 1000);
    } else {
      // Camera OFF - red background
      cameraStatus.className = 'flex items-center space-x-2 bg-red-500/90 backdrop-blur-sm rounded-lg px-3 py-2 transition-all duration-300 shadow-lg';
      cameraStatus.innerHTML = '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path>' +
        '<line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="4" y1="4" x2="20" y2="20"></line>' +
        '</svg>' +
        '<span class="text-white text-xs font-semibold">OFF</span>';
    }
  }
  
  showToast(isVideoEnabled ? 'Camera on' : 'Camera off');
}

function toggleMute() {
  if (!localStream || localStream.getAudioTracks().length === 0) {
    showToast('Microphone not available');
    return;
  }

  const audioTrack = localStream.getAudioTracks()[0];
  audioTrack.enabled = isMuted;
  isMuted = !isMuted;
  
  // DEBUG: Check presence state when toggling mute
  console.log('========== MUTE TOGGLED ==========');
  console.log('New mute state:', isMuted);
  if (channel && channel.state === 'joined') {
    const presenceList = new Presence(channel).list();
    const count = presenceList ? Object.keys(presenceList).length : 0;
    console.log('Current presence count:', count);
  } else {
    console.log('Channel not properly joined');
  }
  console.log('================================');
  
  updateStatusIndicators();
  
  // Update visual microphone indicator
  const micStatus = document.getElementById('local-mic-status');
  if (micStatus) {
    if (isMuted) {
      // Muted state - red background
      micStatus.className = 'flex items-center space-x-2 bg-red-500/90 backdrop-blur-sm rounded-lg px-3 py-2 transition-all duration-300 shadow-lg';
      micStatus.innerHTML = '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clip-rule="evenodd"></path>' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path>' +
        '</svg>' +
        '<span class="text-white text-xs font-semibold">MUTED</span>';
    } else {
      // Unmuted state - blue background
      micStatus.className = 'flex items-center space-x-2 bg-blue-500/90 backdrop-blur-sm rounded-lg px-3 py-2 transition-all duration-300 shadow-lg animate-pulse';
      micStatus.innerHTML = '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>' +
        '</svg>' +
        '<span class="text-white text-xs font-semibold">ON</span>';
      // Remove pulse animation after 1 second
      setTimeout(() => {
        if (micStatus && !isMuted) {
          micStatus.className = 'flex items-center space-x-2 bg-blue-500/90 backdrop-blur-sm rounded-lg px-3 py-2 transition-all duration-300 shadow-lg';
        }
      }, 1000);
    }
  }
  
  showToast(isMuted ? 'Microphone off' : 'Microphone on');
}

async function startScreenShare() {
  const screenShareBtn = document.getElementById('screenshare-btn');
  
  try {
    console.log('Starting screen share...');
    
    // Check if peer connection is ready
    if (!pc) {
      throw new Error('Peer connection not established');
    }
    
    // Get screen share stream
    screenShareStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: true,
    });
    
    const videoTrack = screenShareStream.getVideoTracks()[0];
    
    // Important: Set a custom label to identify this as a screen share track
    Object.defineProperty(videoTrack, 'label', {
      writable: true,
      value: 'screen-share-track'
    });
    
    // Set content hint to help with detection
    videoTrack.contentHint = 'detail';
    
    console.log('Screen share track created with label:', videoTrack.label);
    
    // CRITICAL: Replace camera video track instead of adding new one
    const videoSender = pc.getSenders().find(sender => 
      sender.track && sender.track.kind === 'video' && 
      sender.track.label !== 'screen-share-track'
    );
    
    if (videoSender) {
      console.log('Replacing existing camera track with screen share');
      await videoSender.replaceTrack(videoTrack);
    } else {
      console.log('No existing camera track, adding screen share track');
      pc.addTrack(videoTrack, screenShareStream);
    }
    
    // Handle screen share audio if present
    if (screenShareStream.getAudioTracks().length > 0) {
      const audioTrack = screenShareStream.getAudioTracks()[0];
      // Don't replace audio track, add as separate track
      pc.addTrack(audioTrack, screenShareStream);
      console.log('Screen share audio track added');
    }
    
    // Signal to other peers that we're now screen sharing BEFORE renegotiation
    if (channel) {
      channel.push('screen_share_started', { userId: 'local' });
      console.log('Sent screen share started signal');
    }
    
    // Set up track ended handler
    videoTrack.onended = async () => {
      console.log('Screen share ended by user');
      await stopScreenShare();
    };
    
    isScreenSharing = true;
    
    // IMPORTANT: Keep original camera stream for local display
    // Don't create custom camera content - keep showing the real camera
    
    // Update local video display to continue showing camera
    updateLocalVideoDisplay();
    
    // Show our own screen share in the screen share layout
    const screenShareVideo = document.getElementById('videoplayer-screenshare');
    if (screenShareVideo) {
      screenShareVideo.srcObject = screenShareStream;
      screenShareVideo.autoplay = true;
      screenShareVideo.playsinline = true;
      screenShareVideo.muted = true;
      
      screenShareVideo.play().catch(e => {
        console.log('Screen share video autoplay prevented:', e);
      });
      
      showScreenShareLayout();
      
      const stopBtn = document.getElementById('stop-screenshare-btn');
      if (stopBtn) {
        stopBtn.classList.remove('hidden');
      }
      
      const nameLabel = document.getElementById('screenshare-participant-name');
      if (nameLabel) {
        nameLabel.textContent = 'Your Screen Share';
      }
    }
    
    // Update button styling
    if (screenShareBtn) {
      screenShareBtn.classList.remove('bg-gray-100', 'hover:bg-gray-200', 'text-gray-700');
      screenShareBtn.classList.add('bg-blue-600', 'hover:bg-blue-700');
      const icon = screenShareBtn.querySelector('svg');
      if (icon) {
        icon.classList.remove('text-gray-700');
        icon.classList.add('text-white');
      }
    }
    
    showToast('Screen sharing started');
    console.log('Screen share started successfully');
    
  } catch (error) {
    console.error('Failed to start screen share:', error);
    
    // Clean up on error
    if (screenShareStream) {
      screenShareStream.getTracks().forEach(track => track.stop());
      screenShareStream = undefined;
    }
    
    if (customCameraStream) {
      customCameraStream.getTracks().forEach(track => track.stop());
      customCameraStream = undefined;
    }
    
    isScreenSharing = false;
    updateLocalVideoDisplay();
    
    // Show appropriate error message
    if (error.name === 'NotAllowedError') {
      showToast('Screen sharing permission denied');
    } else if (error.name === 'NotSupportedError') {
      showToast('Screen sharing not supported in this browser');
    } else {
      showToast('Failed to start screen sharing');
    }
  }
}

async function stopScreenShare() {
  const screenShareBtn = document.getElementById('screenshare-btn');
  
  try {
    console.log('Stopping screen share...');
    
    // Signal to other peers that we stopped screen sharing FIRST
    if (channel) {
      channel.push('screen_share_stopped', { userId: 'local' });
      console.log('Sent screen share stopped signal');
    }
    
    if (screenShareStream && pc) {
      // CRITICAL: Replace screen share track back with camera track
      const screenShareVideoSender = pc.getSenders().find(sender => 
        sender.track && sender.track.kind === 'video' && 
        sender.track.label === 'screen-share-track'
      );
      
      if (screenShareVideoSender && originalVideoTrack && originalVideoTrack.readyState === 'live') {
        console.log('Replacing screen share track with original camera track');
        await screenShareVideoSender.replaceTrack(originalVideoTrack);
      } else if (screenShareVideoSender) {
        console.log('Removing screen share track (no camera to replace with)');
        pc.removeTrack(screenShareVideoSender);
      }
      
      // Remove screen share audio tracks
      const screenShareTracks = screenShareStream.getTracks();
      const senders = pc.getSenders();
      
      for (const sender of senders) {
        if (sender.track && screenShareTracks.includes(sender.track) && sender.track.kind === 'audio') {
          console.log('Removing screen share audio sender');
          pc.removeTrack(sender);
        }
      }
      
      // Stop all screen share tracks
      screenShareTracks.forEach(track => {
        console.log('Stopping track:', track.kind, track.label);
        track.stop();
      });
      
      screenShareStream = undefined;
    }
    
    // Clean up custom camera stream (if any)
    if (customCameraStream) {
      customCameraStream.getTracks().forEach(track => track.stop());
      customCameraStream = undefined;
    }
    
    isScreenSharing = false;
    
    // Update local video display back to normal camera
    updateLocalVideoDisplay();
    
    // Hide screen share layout
    hideScreenShareLayout();
    
    // Hide stop button
    const stopBtn = document.getElementById('stop-screenshare-btn');
    if (stopBtn) {
      stopBtn.classList.add('hidden');
    }
    
    // Update button styling back to normal
    if (screenShareBtn) {
      screenShareBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
      screenShareBtn.classList.add('bg-gray-100', 'hover:bg-gray-200');
      const icon = screenShareBtn.querySelector('svg');
      if (icon) {
        icon.classList.remove('text-white');
        icon.classList.add('text-gray-700');
      }
    }
    
    showToast('Screen sharing stopped');
    console.log('Screen share stopped successfully');
    
  } catch (error) {
    console.error('Failed to stop screen share:', error);
  }
}

function removeScreenShare() {
  console.log('Removing screen share');
  const screenShareVideo = document.getElementById('videoplayer-screenshare');
  if (screenShareVideo) {
    screenShareVideo.srcObject = null;
  }
  hideScreenShareLayout();
}

async function toggleScreenShare() {
  try {
    if (isScreenSharing) {
      await stopScreenShare();
    } else {
      await startScreenShare();
    }
  } catch (error) {
    console.error('Screen share toggle failed:', error);
    showError('Failed to share screen. Please try again.');
  }
}

async function joinChannel() {
  // Get room ID from the URL path
  // URL format: /calls/room-id or /calls/room-id/...
  const pathSegments = window.location.pathname.split('/').filter(s => s);
  
  // pathSegments should be ['calls', 'room-id', ...]
  const roomId = pathSegments[1]; // Get the second non-empty segment
  
  console.log('Extracted room ID from path:', roomId, 'Full path:', window.location.pathname);
  
  if (!roomId) {
    showError('Invalid room ID');
    return;
  }

  const socket = new Socket('/socket');
  socket.connect();
  
  channel = socket.channel(`peer:signalling:${roomId}`);

  channel.onError(() => {
    console.log('Channel error event - isCallEnding:', isCallEnding);
    
    // Only show error and reconnect if call is not being intentionally ended
    if (!isCallEnding) {
      socket.disconnect();
      showError('Connection lost. Attempting to reconnect...');
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    }
  });
  
  channel.onClose(() => {
    console.log('Channel close event - isCallEnding:', isCallEnding);
    
    // Only show error and redirect if call is not being intentionally ended
    if (!isCallEnding) {
      socket.disconnect();
      showError('Connection closed. Redirecting...');
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    }
  });

  // SDP offer handling
  channel.on('sdp_offer', async (payload) => {
    console.log('========== RECEIVED SDP OFFER FROM SERVER ==========');
    const sdpOffer = payload.body;
    console.log('SDP Offer length:', sdpOffer?.length, 'chars');
    console.log('Current signaling state:', pc.signalingState);
    console.log('Local tracks already added:', localTracksAdded);
    console.log('Local stream available:', !!localStream, 'tracks:', localStream?.getTracks().length);
    console.log('===================================================');

    try {
      if (pc.signalingState === 'have-local-offer') {
        console.log('Glare detected - rolling back local offer');
        await pc.setLocalDescription({ type: 'rollback' });
      }

      // CRITICAL: Set remote description FIRST to create transceivers from the offer
      console.log('Setting remote description (offer) FIRST...');
      await pc.setRemoteDescription({ type: 'offer', sdp: sdpOffer });
      console.log('✅ Set remote description (offer)');
      console.log('Transceivers after setting remote offer:', pc.getTransceivers().map(t => ({
        mid: t.mid,
        direction: t.direction,
        currentDirection: t.currentDirection,
        sender: t.sender.track ? {kind: t.sender.track.kind, id: t.sender.track.id, enabled: t.sender.track.enabled} : 'no track',
        receiver: t.receiver.track ? {kind: t.receiver.track.kind, id: t.receiver.track.id} : 'no track'
      })));

      // Assign local tracks to existing sendonly senders using replaceTrack.
      // replaceTrack does NOT change transceiver direction (stays sendonly) and does NOT
      // trigger onnegotiationneeded, so no unwanted renegotiation cycle with the server.
      if (localStream && !localTracksAdded) {
        const videoTrack = localStream.getVideoTracks()[0] || null;
        const audioTrack = localStream.getAudioTracks()[0] || null;

        console.log('Assigning local tracks via replaceTrack:', {
          video: videoTrack ? `${videoTrack.kind} ${videoTrack.id}` : 'none',
          audio: audioTrack ? `${audioTrack.kind} ${audioTrack.id}` : 'none'
        });

        for (const transceiver of pc.getTransceivers()) {
          if (transceiver.direction !== 'sendonly' || transceiver.sender.track) continue;

          const kind = transceiver.receiver.track?.kind;
          console.log(`Found idle sendonly transceiver mid=${transceiver.mid} kind=${kind}`);

          if (kind === 'video' && videoTrack) {
            await transceiver.sender.replaceTrack(videoTrack);
            console.log('✅ Assigned video track to sender');
          } else if (kind === 'audio' && audioTrack) {
            await transceiver.sender.replaceTrack(audioTrack);
            console.log('✅ Assigned audio track to sender');
          }
        }

        localTracksAdded = true;

        console.log('Transceivers after track assignment:', pc.getTransceivers().map(t => ({
          mid: t.mid,
          direction: t.direction,
          senderTrack: t.sender.track?.kind || null,
          receiverTrack: t.receiver.track?.kind || null
        })));
      } else if (!localStream) {
        console.error('localStream is undefined — no media to send');
      }

      // Create and set answer with our tracks included
      const sdpAnswer = await pc.createAnswer();
      await pc.setLocalDescription(sdpAnswer);
      console.log('✅ Created and set local description (answer)');
      console.log('Answer SDP preview:', sdpAnswer.sdp.substring(0, 500));
      
      // Count m= lines in our answer to verify we're sending tracks
      const answerAudioLines = (sdpAnswer.sdp.match(/m=audio/g) || []).length;
      const answerVideoLines = (sdpAnswer.sdp.match(/m=video/g) || []).length;
      console.log('📤 Our answer includes:', answerVideoLines, 'video and', answerAudioLines, 'audio m= lines');
      
      // Check sendrecv/sendonly/recvonly directions in answer
      const sendrecvCount = (sdpAnswer.sdp.match(/a=sendrecv/g) || []).length;
      const sendonlyCount = (sdpAnswer.sdp.match(/a=sendonly/g) || []).length;
      const recvonlyCount = (sdpAnswer.sdp.match(/a=recvonly/g) || []).length;
      console.log('📤 Answer directions - sendrecv:', sendrecvCount, 'sendonly:', sendonlyCount, 'recvonly:', recvonlyCount);
      
      // CRITICAL: Alert if we don't have bidirectional transceivers
      if (sendrecvCount === 0) {
        console.error('❌❌❌ CRITICAL: No sendrecv transceivers! Answer will not send media! ❌❌❌');
        console.error('This means tracks were NOT added correctly to transceivers');
        console.error('Expected: sendrecv: 2, Got: sendrecv:', sendrecvCount);
      } else if (sendrecvCount < 2) {
        console.warn('⚠️ WARNING: Only', sendrecvCount, 'sendrecv transceiver(s), expected 2');
      } else {
        console.log('✅✅✅ SUCCESS: Both transceivers are bidirectional (sendrecv) ✅✅✅');
      }
      
      console.log('Transceivers in answer:', pc.getTransceivers().map(t => ({
        mid: t.mid,
        direction: t.direction,
        currentDirection: t.currentDirection,
        senderTrack: t.sender.track ? t.sender.track.kind : 'none',
        receiverTrack: t.receiver.track ? t.receiver.track.kind : 'none'
      })));

      // Log the full SDP for debugging
      console.log('========== FULL SDP ANSWER ==========');
      console.log(sdpAnswer.sdp);
      console.log('=====================================');

      channel.push('sdp_answer', { body: sdpAnswer.sdp });
      console.log('✅ Sent SDP answer to server');
      
      // Final verification
      setTimeout(() => {
        console.log('========== POST-ANSWER STATE CHECK ==========');
        console.log('Peer connection state:', pc.connectionState);
        console.log('ICE connection state:', pc.iceConnectionState);
        console.log('Signaling state:', pc.signalingState);
        console.log('All senders:', pc.getSenders().map(s => ({
          track: s.track ? {kind: s.track.kind, id: s.track.id, enabled: s.track.enabled, readyState: s.track.readyState} : null
        })));
        console.log('All receivers:', pc.getReceivers().map(r => ({
          track: r.track ? {kind: r.track.kind, id: r.track.id, enabled: r.track.enabled, readyState: r.track.readyState} : null
        })));
        console.log('===========================================');
      }, 1000);
    } catch (error) {
      console.error('Error handling SDP offer:', error);
    }
  });

  // Add missing SDP answer handling
  channel.on('sdp_answer', async (payload) => {
    const sdpAnswer = payload.body;
    console.log('Received SDP answer, current state:', pc.signalingState);
    
    try {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer });
        console.log('Applied SDP answer');
      } else {
        console.log('Received SDP answer but not in correct state:', pc.signalingState);
      }
    } catch (error) {
      console.error('Error handling SDP answer:', error);
    }
  });

  // Add missing ICE candidate handling
  channel.on('ice_candidate', (payload) => {
    const candidate = JSON.parse(payload.body);
    console.log('Received ICE candidate');
    pc.addIceCandidate(candidate).catch(err => {
      console.error('Error adding ICE candidate:', err);
    });
  });

  // CRITICAL: Add screen share event handlers
  channel.on('screen_share_started', (payload) => {
    console.log('Received screen share started signal:', payload);
    screenShareSignalTime = Date.now(); // Mark when signal was received
    // The actual screen share track will come through pc.ontrack
    // This is just a notification that screen sharing started
  });

  channel.on('screen_share_stopped', (payload) => {
    console.log('Received screen share stopped signal:', payload);
    // Clean up any screen share UI that might not have been cleaned up by track.onended
    removeScreenShare();
  });

  // Add presence handling
  const presence = new Presence(channel);
  
  presence.onSync(() => {
    const presenceList = presence.list();
    const count = presenceList ? Object.keys(presenceList).length : 0;
    
    console.log('Presence sync - participants:', count);
    updateParticipantDisplays(count);
  });

  presence.onJoin((id, current, newPres) => {
    console.log('Participant joined:', id);
    
    setTimeout(() => {
      const actualList = presence.list();
      const actualCount = (actualList && typeof actualList === 'object') ? Object.keys(actualList).length : 0;
      console.log('After join, actual participant count:', actualCount);
      updateParticipantDisplays(actualCount);
      
      if (actualCount > 1) {
        const remoteContainer = document.getElementById('remote-video-container');
        if (remoteContainer && remoteContainer.classList.contains('hidden')) {
          console.log('Force showing remote container after participant join');
          remoteContainer.classList.remove('hidden');
        }
      }
      
      updateVideoGrid();
      // The server automatically sends a new offer via peer_added notification — no need to request one.
    }, 100);
  });

  presence.onLeave((id, current, leftPres) => {
    console.log('Participant left:', id);
    
    const remoteContainer = document.getElementById('remote-video-container');
    const remoteVideo = document.getElementById('videoplayer-remote');
    
    if (remoteContainer && !remoteContainer.classList.contains('hidden')) {
      console.log('Hiding remote container as participant left');
      remoteContainer.classList.add('hidden');
      
      if (remoteVideo) {
        remoteVideo.srcObject = null;
        remoteVideo.style.display = 'none';
      }
      
      const placeholder = remoteContainer.querySelector('.no-video-placeholder');
      if (placeholder) {
        placeholder.remove();
      }
      
      updateVideoGrid();
    }
    
    setTimeout(() => {
      const actualList = presence.list();
      const actualCount = (actualList && typeof actualList === 'object') ? Object.keys(actualList).length : 0;
      console.log('After leave, actual participant count:', actualCount);
      updateParticipantDisplays(actualCount);
      updateVideoGrid();
    }, 100);
  });

  channel
    .join()
    .receive('ok', (_) => {
      console.log('========== CHANNEL JOIN SUCCESSFUL ==========');
      console.log(`Successfully joined channel for room: ${roomId}`);
      console.log('Waiting for SDP offer from server...');
      console.log('============================================');
      hideError();
    })
    .receive('error', (resp) => {
      console.error(`Failed to join channel for room ${roomId}:`, resp);
      socket.disconnect();

      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
        localStream = undefined;
      }

      let errorMessage = 'Unable to join the room';
      if (resp == 'peer_limit_reached') {
        errorMessage += ': Peer limit reached. Try again in a few minutes';
      }
      showError(errorMessage);
    });
}

function setupUIEventListeners() {
  // Participants panel toggle
  const participantsToggle = document.getElementById('participants-toggle');
  const closeParticipants = document.getElementById('close-participants');
  
  if (participantsToggle) {
    participantsToggle.addEventListener('click', toggleParticipantsPanel);
  }
  
  if (closeParticipants) {
    closeParticipants.addEventListener('click', () => {
      participantsPanelOpen = true; // Will be toggled to false
      toggleParticipantsPanel();
    });
  }

  // Settings toggle
  const settingsToggle = document.getElementById('settings-toggle');
  if (settingsToggle) {
    settingsToggle.addEventListener('click', () => {
      // Implement settings panel
    });
  }

  // Screen share button - Add direct event listener
  const screenShareBtn = document.getElementById('screenshare-btn');
  if (screenShareBtn) {
    screenShareBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      console.log('Screen share button clicked, current state:', isScreenSharing);
      await toggleScreenShare();
    });
  }

  // Stop screen share button
  const stopScreenShareBtn = document.getElementById('stop-screenshare-btn');
  if (stopScreenShareBtn) {
    stopScreenShareBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await stopScreenShare();
    });
  }

  // Mute button - Add direct event listener
  const muteBtn = document.getElementById('mute-btn');
  if (muteBtn) {
    muteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleMute();
    });
  }

  // Video button - Add direct event listener  
  const videoBtn = document.getElementById('video-btn');
  if (videoBtn) {
    videoBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleVideo();
    });
  }

  // End call button - Handle cleanup when button is clicked
  // The phx-click="end_call" will handle navigation, we just need to cleanup
  const endCallBtn = document.getElementById('end-call-btn');
  if (endCallBtn) {
    endCallBtn.addEventListener('click', (e) => {
      // Let LiveView handle the event, but cleanup local resources
      endCall();
    });
  }

  // Meeting ID copy
  const meetingIdCopy = document.querySelector('[data-copy-meeting-id]');
  if (meetingIdCopy) {
    meetingIdCopy.addEventListener('click', () => {
      navigator.clipboard.writeText('meet-123-456');
      showToast('Meeting ID copied to clipboard');
    });
  }
}

function showToast(message, duration = 3000) {
  // Create toast notification
  const toast = document.createElement('div');
  toast.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-black/80 text-white px-4 py-3 rounded-lg text-sm z-50 backdrop-blur-sm max-w-md text-center';
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, duration);
}

function showError(message) {
  const errorElement = document.getElementById('join-error-message');
  const errorText = document.getElementById('error-text');
  if (errorElement && errorText) {
    errorText.textContent = message;
    errorElement.classList.remove('hidden');
  }
}

function hideError() {
  const errorElement = document.getElementById('join-error-message');
  if (errorElement) {
    errorElement.classList.add('hidden');
  }
}

function showMobilePermissionHelper() {
  const helper = document.getElementById('mobile-permission-helper');
  if (helper) {
    helper.classList.remove('hidden');
    helper.classList.add('flex');
  }
}

function hideMobilePermissionHelper() {
  const helper = document.getElementById('mobile-permission-helper');
  if (helper) {
    helper.classList.add('hidden');
    helper.classList.remove('flex');
  }
}

// Global debug utility - access via window.debugWebRTC() in console
window.debugWebRTC = function() {
  const pathSegments = window.location.pathname.split('/').filter(s => s);
  const roomId = pathSegments[1];
  
  console.log('==================== WEBRTC DEBUG ====================');
  console.log('Current URL:', window.location.href);
  console.log('Path:', window.location.pathname);
  console.log('Path segments:', pathSegments);
  console.log('Extracted Room ID:', roomId);
  console.log('Room ID valid (alphanumeric/dash/underscore 1-50 chars):', /^[a-zA-Z0-9_-]{1,50}$/.test(roomId));
  console.log('');
  console.log('Channel state:');
  console.log('  - Channel object exists:', !!channel);
  console.log('  - Channel state:', channel?.state);
  console.log('  - Channel topic:', channel?.topic);
  console.log('');
  console.log('PeerConnection state:');
  console.log('  - PC exists:', !!pc);
  console.log('  - Signaling state:', pc?.signalingState);
  console.log('  - ICE connection state:', pc?.iceConnectionState);
  console.log('  - ICE gathering state:', pc?.iceGatheringState);
  console.log('  - Connection state:', pc?.connectionState);
  console.log('');
  console.log('Media state:');
  console.log('  - Local stream exists:', !!localStream);
  console.log('  - Local tracks added:', localTracksAdded);
  if (localStream) {
    console.log('  - Local tracks:', localStream.getTracks().map(t => ({kind: t.kind, id: t.id, label: t.label, enabled: t.enabled})));
  }
  console.log('  - Remote streams:', pc?.getReceivers().filter(r => r.track).map(r => ({kind: r.track.kind, id: r.track.id})));
  console.log('');
  console.log('Security context:');
  console.log('  - Is secure:', window.isSecureContext);
  console.log('  - Protocol:', window.location.protocol);
  console.log('  - Hostname:', window.location.hostname);
  console.log('=====================================================');
  
  return {
    roomId,
    channelState: channel?.state,
    pcSignalingState: pc?.signalingState,
    iceState: pc?.iceConnectionState,
    hasLocalStream: !!localStream,
    hasPC: !!pc,
    hasChannel: !!channel
  };
};

console.log('💡 Type window.debugWebRTC() in console to see connection status');
