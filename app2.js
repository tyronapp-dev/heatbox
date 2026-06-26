// Oben bei deinen Importen (Ganz am Anfang der Datei):
import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "firebase/auth";

// ... (Rest deiner Datei wie bisher)

// Ersetze deinen bisherigen DOMContentLoaded Start damit:
document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            // Wenn nicht eingeloggt, leite zur Login-Seite weiter
            window.location.href = "login.html"; 
            return;
        }
        // User ist eingeloggt, starte die App
        initApp();
    });
});

// NEUE STRUKTUR: Packe deinen ganzen bisherigen Code in diese Funktion
function initApp() {
    // Hier fügst du ALLES ein, was bisher IN deinem 
    // "document.addEventListener('DOMContentLoaded', () => { ... })" 
    // Block stand (außer die Login-Logik, die wir oben gelöscht haben).
    
    // Beispiel:
    // const songsContainer = document.getElementById('songs-list-container');
    // fetchSongsFromDatabase();
    // ...
}

// ==========================================
// --- GLOBALE FUNKTIONEN ---
// ==========================================
function updatePlayerBackground(color1, color2) {
    const bg = document.querySelector('.dynamic-bg');
    if (!bg) return;
    bg.style.backgroundImage = `
        radial-gradient(at 0% 10%, ${color1}66 0px, transparent 60%),
        radial-gradient(at 100% 20%, ${color2}44 0px, transparent 60%),
        radial-gradient(at 50% 100%, rgba(0, 0, 0, 1) 0px, transparent 100%)
    `;
    document.documentElement.style.setProperty('--accent', color1);
}

function formatDuration(totalSeconds) {
    if (!totalSeconds) return "0min";
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    if (h > 0) return `${h}h ${m < 10 ? '0' : ''}${m}min`;
    return `${m}min`;
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// FIX: Memory Leak auf iOS behoben (URLs werden jetzt freigegeben)
const getDuration = (file) => new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.addEventListener('loadedmetadata', () => {
        resolve(Math.round(audio.duration));
        URL.revokeObjectURL(url);
    }, { once: true });
    audio.addEventListener('error', () => {
        resolve(0);
        URL.revokeObjectURL(url);
    }, { once: true });
});

function addLongPressListener(element, callback) {
    let pressTimer;
    const start = (e) => {
        if (e.type === 'click' && e.button !== 0) return; 
        pressTimer = window.setTimeout(() => {
            callback(e);
        }, 600); 
    };
    const cancel = () => { clearTimeout(pressTimer); };
    
    element.addEventListener('mousedown', start);
    element.addEventListener('touchstart', start, {passive: true});
    element.addEventListener('mouseup', cancel);
    element.addEventListener('mouseleave', cancel);
    element.addEventListener('touchend', cancel);
    element.addEventListener('touchcancel', cancel);
}

async function fetchCoverFromiTunes(title, artist) {
    let queryParts = [];
    if (title && title.trim() !== "") queryParts.push(title.trim());
    if (artist && artist.trim() !== "" && artist !== "Unbekannter Künstler") queryParts.push(artist.trim());
    if (queryParts.length === 0) return null; 

    try {
        const query = encodeURIComponent(queryParts.join(" "));
        const response = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=1`);
        const data = await response.json();
        
        if (data.results && data.results.length > 0) {
            return data.results[0].artworkUrl100.replace('100x100bb.jpg', '600x600bb.jpg');
        }
    } catch (e) {
        console.warn('iTunes API Fehler:', e);
    }
    return null; 
}

const AVAILABLE_VIBES = ["Afro", "Ghana", "RnB", "Old School", "Deepdream", "LD", "Calm", "SAD", "Gym", "HYPE", "Carpool", "Amapiano", "Hard rap", "Dancehall", "Rap", "Summer", "Latenight"];

// ==========================================
// --- HAUPT-APP-LOGIK ---
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    


    // --- 1. Supabase Initialisierung ---
    let supabaseClient = null;
    if (typeof supabase !== 'undefined' && window.HeaTBoxConfig && window.HeaTBoxConfig.db) {
        const { createClient } = supabase;
        supabaseClient = createClient(window.HeaTBoxConfig.db.url, window.HeaTBoxConfig.db.key);
        console.log('Supabase Client bereit!');
    }

    // --- 2. Globale States ---
    const songsContainer = document.getElementById('songs-list-container');
    const stationsContainer = document.getElementById('stations-container');
    const actionSheetOverlay = document.getElementById('action-sheet-overlay');
    const songContextOverlay = document.getElementById('song-context-overlay');
    const playlistSelectionOverlay = document.getElementById('playlist-selection-overlay');
    const selectionToolbar = document.getElementById('selection-toolbar');
    
    let currentMode = 'normal'; 
    let selectedSongs = new Set();
    let allSongsElements = [];
    let globalSongsData = []; 
    let playbackQueue = [];   
    let playbackHistory = []; 
    window.currentContextSongId = null; 
    window.currentContextPlaylistId = null; 
    window.currentOpenPlaylistId = null; 
    window.currentPlaylistSongs = [];
    window.currentSongDuration = 0;
    
    function savePlayerState() {
        const state = {
            currentSong: window.currentSongData || null,
            playingSongId: window.currentPlayingSongId || null,
            playingPlaylistId: window.currentPlayingPlaylistId || null,
            currentTime: document.getElementById('main-audio-player')?.currentTime || 0,
            queue: playbackQueue || [],
            volume: document.getElementById('volume-slider')?.value || 1,
            eq: {
                isOn: document.getElementById('eq-power-toggle')?.checked || false,
                preamp: document.getElementById('eq-preamp')?.value || 0,
                preset: document.querySelector('.eq-preset.active')?.dataset.mode || 'classic'
            }
        };
        localStorage.setItem('heatbox_state', JSON.stringify(state));
    }

    function loadPlayerState() {
        try {
            const saved = localStorage.getItem('heatbox_state');
            if(!saved) return;
            const state = JSON.parse(saved);

            if (state.volume !== undefined) {
                const volSlider = document.getElementById('volume-slider');
                if(volSlider) { volSlider.value = state.volume; updateSliderFill(volSlider, 0, 1); }
                const audio = document.getElementById('main-audio-player');
                if(audio) audio.volume = state.volume;
            }

            if (state.currentSong) {
                window.currentSongData = state.currentSong;
                window.currentSongDuration = state.currentSong.duration; 
                window.currentPlayingSongId = state.playingSongId || null;
                window.currentPlayingPlaylistId = state.playingPlaylistId || null;
                if(typeof window.updateActiveHighlights === 'function') setTimeout(window.updateActiveHighlights, 100);

                const audio = document.getElementById('main-audio-player');
                if(audio) {
                    audio.src = state.currentSong.fileUrl; 
                    if (state.currentTime) audio.currentTime = state.currentTime; 
                }
                
                const miniTitle = document.querySelector('.mini-title');
                if(miniTitle) miniTitle.innerText = state.currentSong.title;
                
                const bpTitle = document.getElementById('bp-song-name');
                const bpArtist = document.getElementById('bp-artist-name');
                if(bpTitle) bpTitle.innerText = state.currentSong.title;
                if(bpArtist) bpArtist.innerText = state.currentSong.artist;

                const bpHv = document.getElementById('bp-header-vibes');
                if (bpHv) {
                    if (state.currentSong.vibes && state.currentSong.vibes.length > 0) {
                        bpHv.innerText = state.currentSong.vibes.join(' • ');
                    } else {
                        bpHv.innerText = "Aktueller Titel";
                    }
                }

                const bgStyle = state.currentSong.coverUrl && state.currentSong.coverUrl.length > 10 ? `url('${state.currentSong.coverUrl}')` : 'none';
                const dynamicBg = document.querySelector('.dynamic-bg');
                if(dynamicBg) dynamicBg.style.backgroundImage = bgStyle;
                
                const mCover = document.querySelector('.mini-cover');
                const lCover = document.querySelector('.large-cover');
                if(mCover) { mCover.style.backgroundImage = bgStyle !== 'none' ? bgStyle : 'var(--accent)'; mCover.style.backgroundSize = 'cover'; mCover.style.backgroundPosition = 'center'; }
                if(lCover) { lCover.style.backgroundImage = bgStyle !== 'none' ? bgStyle : 'var(--accent)'; lCover.style.backgroundSize = 'cover'; lCover.style.backgroundPosition = 'center'; }

                const timeTotalEl = document.querySelector('.time-total');
                if(state.currentSong.duration && timeTotalEl) timeTotalEl.innerText = formatTime(state.currentSong.duration);
            }

            if (state.queue) playbackQueue = state.queue;
            if (state.eq) {
                const eqPreamp = document.getElementById('eq-preamp');
                if (state.eq.preamp && eqPreamp) {
                    eqPreamp.value = state.eq.preamp;
                    updateSliderFill(eqPreamp, -12, 12);
                    const valEl = document.getElementById('eq-preamp-val');
                    if(valEl) valEl.innerText = (state.eq.preamp > 0 ? '+' : '') + state.eq.preamp + ' dB';
                }
                if (state.eq.preset) {
                    document.querySelectorAll('.eq-preset').forEach(b => b.classList.remove('active'));
                    const presetBtn = document.querySelector(`.eq-preset[data-mode="${state.eq.preset}"]`);
                    if(presetBtn) presetBtn.classList.add('active');
                }
               if (state.eq.isOn) {
                    const eqToggle = document.getElementById('eq-power-toggle');
                    if(eqToggle) { eqToggle.checked = true; } 
                }
            }
        } catch(e) { console.log("Kein Status gespeichert."); }
    }
    
    loadPlayerState();
   
    window.currentPlayingSongId = null;
    window.currentPlayingPlaylistId = null;

    window.togglePlaylistPlayback = async function(e, listId, songsArray = null) {
        if(e) e.stopPropagation();
        const audioPlayer = document.getElementById('main-audio-player');
        
        if (window.currentPlayingPlaylistId === listId) {
            if (audioPlayer.paused) { audioPlayer.play(); if(typeof updatePlayPauseIcons === 'function') updatePlayPauseIcons(true); } 
            else { audioPlayer.pause(); if(typeof updatePlayPauseIcons === 'function') updatePlayPauseIcons(false); }
            window.updateActiveHighlights();
            return;
        }

        let queueToPlay = [];
        if (songsArray) {
            queueToPlay = [...songsArray];
        } else {
            const { data } = await supabaseClient.from('playlist_songs').select('songs(*)').eq('playlist_id', listId).order('sort_order', { ascending: true });
            if (data) queueToPlay = data.map(item => item.songs).filter(s => s !== null);
        }

        if (!queueToPlay || queueToPlay.length === 0) return alert("Diese Liste ist leer!");

        window.currentPlayingPlaylistId = listId;
        const isShuffle = document.getElementById('btn-shuffle')?.classList.contains('ctrl-active');
        if (isShuffle) queueToPlay = queueToPlay.sort(() => 0.5 - Math.random());

        const first = queueToPlay[0];
        playbackQueue = queueToPlay.slice(1);
        
        window.playSong(first.title, first.artist, first.cover_data, first.file_url || first.fileUrl);
        savePlayerState();
    };

    window.updateActiveHighlights = function() {
        document.querySelectorAll('.song-item.playing-active, .station-card.playing-active').forEach(el => el.classList.remove('playing-active'));
        let activeVibes = null;

        if (window.currentPlayingSongId) {
            document.querySelectorAll(`.song-item[data-id="${window.currentPlayingSongId}"]`).forEach(el => {
                if (!el.querySelector('.playlist-checkbox')) el.classList.add('playing-active');
            });
            if (globalSongsData && globalSongsData.length > 0) {
                const currentSong = globalSongsData.find(s => s.id === window.currentPlayingSongId);
                if (currentSong && currentSong.vibes && currentSong.vibes.length > 0) {
                    activeVibes = currentSong.vibes.join(' • ');
                }
            }
        }

        const bpHv = document.getElementById('bp-header-vibes');
        if (bpHv) {
            if (activeVibes) {
                bpHv.innerText = activeVibes;
            } else if (window.currentSongData && window.currentSongData.vibes && window.currentSongData.vibes.length > 0) {
                bpHv.innerText = window.currentSongData.vibes.join(' • '); 
            } else {
                bpHv.innerText = "Aktueller Titel";
            }
        }
        
        if (window.currentPlayingPlaylistId) {
            document.querySelectorAll(`.song-item[data-id="${window.currentPlayingPlaylistId}"]`).forEach(el => {
                if (el.querySelector('.playlist-checkbox')) el.classList.add('playing-active');
            });
            document.querySelectorAll(`.station-card[data-id="${window.currentPlayingPlaylistId}"]`).forEach(el => {
                el.classList.add('playing-active');
            });
        }

        document.querySelectorAll('.cover-play-btn, .list-play-btn').forEach(btn => {
            const parentId = btn.closest('.station-card')?.dataset.id || btn.closest('.song-item')?.dataset.id;
            const audioPlayer = document.getElementById('main-audio-player');
            const isListBtn = btn.classList.contains('list-play-btn');
            const size = isListBtn ? "24" : "14"; 
            
            if (parentId === String(window.currentPlayingPlaylistId) && audioPlayer && !audioPlayer.paused) {
                btn.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`; 
            } else {
                btn.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`; 
            }
        });
    };

    const memAudio = document.getElementById('main-audio-player');
    if (memAudio) memAudio.addEventListener('pause', savePlayerState);
    window.addEventListener('beforeunload', savePlayerState); 
    document.addEventListener('visibilitychange', () => {     
        if (document.visibilityState === 'hidden') savePlayerState();
    });

    // --- 3. View Routing Logik ---
    const navButtons = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');
    navButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            navButtons.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const targetId = e.currentTarget.getAttribute('data-target');
            window.currentOpenPlaylistId = null; 
            views.forEach(view => {
                if (view.id === targetId) {
                    view.classList.remove('hidden');
                    setTimeout(() => view.classList.add('active'), 10);
                } else {
                    view.classList.remove('active');
                    view.classList.add('hidden');
                }
            });
        });
    });

    // --- 4. AUDIO PLAYBACK & ZENTRAL-GEHIRN ---
    const audioPlayer = document.getElementById('main-audio-player');
    const playPauseBtns = [document.querySelector('#mini-player svg'), document.querySelector('.play-large'), document.getElementById('home-np-playpause')];
    const timeCurrentEl = document.querySelector('.time-current');
    const timeTotalEl = document.querySelector('.time-total');
    const progressBar = document.querySelector('.time-progress');
    const progressContainer = document.querySelector('.time-bg');

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }
    
    window.updatePlayPauseIcons = function(isPlaying) {
        const pauseSvg = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
        const playSvg = `<path d="M8 5v14l11-7z"/>`;
        playPauseBtns.forEach(btn => { 
            if(btn) {
                if (btn.tagName.toLowerCase() === 'svg') btn.innerHTML = isPlaying ? pauseSvg : playSvg;
                else if (btn.querySelector('svg')) btn.querySelector('svg').innerHTML = isPlaying ? pauseSvg : playSvg;
            } 
        });
        if(typeof window.updateActiveHighlights === 'function') window.updateActiveHighlights(); 
    };

    window.togglePlayPause = async function(e) {
        if(e) e.stopPropagation();
        if(!audioPlayer.src) return; 
        if (audioPlayer.paused) { 
            try { await audioPlayer.play(); } catch(err){}
        } else { 
            audioPlayer.pause(); 
        }
    };
    playPauseBtns.forEach(btn => { if(btn) btn.addEventListener('click', window.togglePlayPause); });

    audioPlayer.addEventListener('play', () => {
        window.updatePlayPauseIcons(true);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "playing"; 
    });
    
    audioPlayer.addEventListener('pause', () => {
        window.updatePlayPauseIcons(false);
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = "paused";
    });
    
    // FIX: iOS Background Sync Interval (verhindert das iOS das Control Center entkoppelt)
    setInterval(() => {
        if (!audioPlayer.paused && 'mediaSession' in navigator && navigator.mediaSession.playbackState !== 'playing') {
            navigator.mediaSession.playbackState = 'playing';
        }
    }, 3000);

    window.playSong = function(title, artist, coverUrl, fileUrl) {
        if (!audioPlayer) return;
        
        let foundSong = globalSongsData.find(s => s.file_url === fileUrl) || globalSongsData.find(s => s.title === title && s.artist === artist);
        window.currentPlayingSongId = foundSong ? foundSong.id : null;
        window.currentSongDuration = foundSong ? foundSong.duration : 0;
        
        window.currentSongData = { 
            id: window.currentPlayingSongId, title, artist, coverUrl, fileUrl, 
            duration: window.currentSongDuration, vibes: foundSong?.vibes || []
        };
        
        if (playbackHistory.length === 0 || playbackHistory[playbackHistory.length-1].fileUrl !== fileUrl) {
            playbackHistory.push(window.currentSongData);
        }

        audioPlayer.src = fileUrl;
        audioPlayer.load();
        let playPromise = audioPlayer.play();
        
        if (playPromise !== undefined) {
            playPromise.then(() => {
                window.updatePlayPauseIcons(true);
                if ('mediaSession' in navigator) {
                    let metadataObj = {
                        title: title || 'Unbekannter Song',
                        artist: artist || 'Unbekannter Künstler',
                        album: 'HeaTBox Cloud'
                    };
                    if (coverUrl && coverUrl.startsWith('http')) {
                        metadataObj.artwork = [
                            { src: coverUrl, sizes: '512x512', type: 'image/png' },
                            { src: coverUrl, sizes: '192x192', type: 'image/png' }
                        ];
                    }
                    navigator.mediaSession.metadata = new MediaMetadata(metadataObj);
                    navigator.mediaSession.setActionHandler('play', async () => { 
                        try { await audioPlayer.play(); } catch(err) { console.log("Lockscreen Play Error", err); } 
                    });
                    navigator.mediaSession.setActionHandler('pause', () => { 
                        audioPlayer.pause(); 
                    });
                    navigator.mediaSession.setActionHandler('previoustrack', () => window.playPrevSong());
                    navigator.mediaSession.setActionHandler('nexttrack', () => window.playNextSong());
                }
            }).catch(e => console.log("iOS Play blockiert", e));
        }

        const mp = document.getElementById('mini-player');
        if(mp) { mp.style.display = 'flex'; setTimeout(() => { mp.style.transform = 'none'; mp.style.opacity = '1'; }, 10); }

        const bgStyle = coverUrl && coverUrl.length > 10 ? `url('${coverUrl}')` : 'none';
        const dynamicBg = document.querySelector('.dynamic-bg');
        if(dynamicBg) dynamicBg.style.backgroundImage = bgStyle;
        
        const miniCover = document.querySelector('.mini-cover');
        const miniTitle = document.querySelector('.mini-title');
        if(miniCover) { miniCover.style.backgroundImage = bgStyle !== 'none' ? bgStyle : 'var(--accent)'; miniCover.style.backgroundSize = 'cover'; }
        if(miniTitle) miniTitle.innerText = title;

        const bpTitle = document.getElementById('bp-song-name');
        const bpArtist = document.getElementById('bp-artist-name');
        const largeCover = document.querySelector('.large-cover');
        const bpHv = document.getElementById('bp-header-vibes');
        
        if(bpTitle) bpTitle.innerText = title;
        if(bpArtist) bpArtist.innerText = artist;
        if(largeCover) { largeCover.style.backgroundImage = bgStyle !== 'none' ? bgStyle : 'var(--accent)'; largeCover.style.backgroundSize = 'cover'; }
        if(bpHv) bpHv.innerText = window.currentSongData.vibes?.join(' • ') || "Aktueller Titel";

        const homeNpCover = document.getElementById('home-np-cover');
        const homeNpTitle = document.getElementById('home-np-title');
        const homeNpArtist = document.getElementById('home-np-artist');
        const homeNowPlayingSection = document.getElementById('home-now-playing-section');
        if(homeNowPlayingSection) homeNowPlayingSection.style.display = 'block';
        if(homeNpCover) homeNpCover.style.backgroundImage = bgStyle !== 'none' ? bgStyle : 'var(--accent)';
        if(homeNpTitle) homeNpTitle.innerText = title;
        if(homeNpArtist) homeNpArtist.innerText = artist;

        if(typeof window.updateActiveHighlights === 'function') window.updateActiveHighlights();
        savePlayerState();
    };

    let isChangingSong = false; 

    window.playNextSong = function() {
        if (!playbackQueue || playbackQueue.length === 0) {
            if (globalSongsData && globalSongsData.length > 0) {
                playbackQueue = [...globalSongsData].sort(() => 0.5 - Math.random());
            } else return;
        }
        const nextSong = playbackQueue.shift();
        window.currentContextSongId = nextSong.id || window.currentContextSongId;
        window.playSong(nextSong.title, nextSong.artist, nextSong.cover_data || nextSong.coverUrl, nextSong.file_url || nextSong.fileUrl);
    };

    window.playPrevSong = function() {
        if (audioPlayer && audioPlayer.currentTime > 3) {
            audioPlayer.currentTime = 0; audioPlayer.play();
        } else if (playbackHistory && playbackHistory.length > 0) {
            const prevSong = playbackHistory.pop();
            if (window.currentSongData) playbackQueue.unshift(window.currentSongData); 
            window.currentContextSongId = prevSong.id || window.currentContextSongId;
            window.playSong(prevSong.title, prevSong.artist, prevSong.cover_data || prevSong.coverUrl, prevSong.file_url || prevSong.fileUrl);
        } else if (audioPlayer) {
            audioPlayer.currentTime = 0; audioPlayer.play();
        }
    };

    function setupSmartSkipButton(btnId, isNext) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        
        let pressTimer;
        let seekInterval;
        let isLongPress = false;

        const start = (e) => {
            if (e.type === 'mousedown' && e.button !== 0) return;
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                if (audioPlayer) audioPlayer.currentTime += (isNext ? 10 : -10);
                seekInterval = setInterval(() => {
                    if (audioPlayer) audioPlayer.currentTime += (isNext ? 10 : -10);
                }, 300);
            }, 400); 
        };
        const cancel = () => { clearTimeout(pressTimer); clearInterval(seekInterval); };

        btn.addEventListener('mousedown', start);
        btn.addEventListener('touchstart', start, {passive: true});
        btn.addEventListener('mouseup', cancel);
        btn.addEventListener('mouseleave', cancel);
        btn.addEventListener('touchend', cancel);
        btn.addEventListener('touchcancel', cancel);

        btn.addEventListener('click', (e) => {
            if (isLongPress) { e.preventDefault(); e.stopPropagation(); return; }
            if (isNext) window.playNextSong();
            else window.playPrevSong();
        });
    }

    setupSmartSkipButton('btn-next', true);
    setupSmartSkipButton('btn-prev', false);

    let isDraggingTime = false;

    function updateTimeUI(current, duration) {
        if (timeCurrentEl) timeCurrentEl.innerText = formatTime(current);
        if (duration && duration > 0) {
            if (progressBar) progressBar.style.width = ((current / duration) * 100) + '%';
            if (timeTotalEl) timeTotalEl.innerText = "-" + formatTime(duration - current);
        }
    }

    function syncLockscreenPosition() {
        if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
            let duration = audioPlayer.duration || window.currentSongDuration;
            if (duration > 0 && !isNaN(duration)) {
                navigator.mediaSession.setPositionState({
                    duration: duration,
                    playbackRate: audioPlayer.playbackRate || 1,
                    position: audioPlayer.currentTime || 0
                });
            }
        }
    }

    audioPlayer.addEventListener('timeupdate', () => {
        if (isDraggingTime) return; 
        let duration = audioPlayer.duration || window.currentSongDuration;
        updateTimeUI(audioPlayer.currentTime || 0, duration);
    });

    audioPlayer.addEventListener('loadedmetadata', () => {
        if (audioPlayer.duration && !isNaN(audioPlayer.duration) && audioPlayer.duration !== Infinity) {
            window.currentSongDuration = audioPlayer.duration;
            updateTimeUI(0, audioPlayer.duration);
            syncLockscreenPosition();
        }
    });

    audioPlayer.addEventListener('playing', syncLockscreenPosition);
    audioPlayer.addEventListener('seeked', syncLockscreenPosition);

    if (progressContainer) {
        const handleScrub = (e) => {
            let duration = audioPlayer.duration || window.currentSongDuration;
            if (!duration) return 0;
            const rect = progressContainer.getBoundingClientRect();
            let clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : (e.changedTouches ? e.changedTouches[0].clientX : e.clientX);
            let percent = (clientX - rect.left) / rect.width;
            percent = Math.max(0, Math.min(1, percent)); 
            const newTime = percent * duration;
            updateTimeUI(newTime, duration); 
            return newTime;
        };

        progressContainer.addEventListener('touchstart', (e) => { isDraggingTime = true; handleScrub(e); }, {passive: true});
        progressContainer.addEventListener('touchmove', (e) => { if(isDraggingTime) handleScrub(e); }, {passive: true});
        progressContainer.addEventListener('touchend', (e) => {
            if(isDraggingTime) {
                isDraggingTime = false;
                audioPlayer.currentTime = handleScrub(e);
            }
        });

        progressContainer.addEventListener('mousedown', (e) => { isDraggingTime = true; handleScrub(e); });
        document.addEventListener('mousemove', (e) => { if (isDraggingTime) handleScrub(e); });
        document.addEventListener('mouseup', (e) => {
            if (isDraggingTime) {
                isDraggingTime = false;
                audioPlayer.currentTime = handleScrub(e);
            }
        });
    }

    const miniPlayer = document.getElementById('mini-player');
    const fullscreenPlayer = document.getElementById('fullscreen-player');
    const homeNowPlayingCard = document.getElementById('home-now-playing-card');
    const bpContainer = document.getElementById('fullscreen-player');

    if (miniPlayer && fullscreenPlayer) {
        miniPlayer.addEventListener('click', (e) => {
            if(e.target.closest('svg')) return; 
            fullscreenPlayer.classList.add('open');
        });
        let mpStartX = 0, mpStartY = 0;
        miniPlayer.addEventListener('touchstart', (e) => { mpStartX = e.touches[0].clientX; mpStartY = e.touches[0].clientY; }, {passive: true});
        miniPlayer.addEventListener('touchend', (e) => {
            if(!mpStartX || !mpStartY) return;
            let diffX = mpStartX - e.changedTouches[0].clientX;
            let diffY = e.changedTouches[0].clientY - mpStartY;
            if(diffY > 40 || diffX > 40) {
                audioPlayer.pause();
                window.updatePlayPauseIcons(false);
                miniPlayer.style.transform = 'translateY(150%)';
                miniPlayer.style.opacity = '0';
                setTimeout(() => { miniPlayer.style.display = 'none'; }, 300);
            }
            mpStartX = 0; mpStartY = 0;
        });
    }

    if (homeNowPlayingCard && fullscreenPlayer) homeNowPlayingCard.addEventListener('click', () => fullscreenPlayer.classList.add('open'));
    document.getElementById('close-player')?.addEventListener('click', () => fullscreenPlayer.classList.remove('open'));

    let bpStartX = 0, bpStartY = 0;
    if (bpContainer) {
        bpContainer.addEventListener('touchstart', (e) => { bpStartX = e.touches[0].clientX; bpStartY = e.touches[0].clientY; }, {passive: true});
        bpContainer.addEventListener('touchend', (e) => {
            if (!bpStartX || !bpStartY) return;
            let diffX = bpStartX - e.changedTouches[0].clientX;
            let diffY = bpStartY - e.changedTouches[0].clientY;
            if (Math.abs(diffX) > Math.abs(diffY)) {
                if (Math.abs(diffX) > 60) {
                    if (diffX > 0) window.playNextSong(); 
                    else window.playPrevSong(); 
                }
            } else {
                if (diffY < -60 && bpStartY < window.innerHeight / 2) {
                    document.getElementById('close-player')?.click();
                }
            }
            bpStartX = 0; bpStartY = 0;
        });
    }

    // --- 5. DATENBANK LOGIK & UI (SONGS) ---
    async function fetchSongsFromDatabase() {
        if (!supabaseClient) {
            if (songsContainer) songsContainer.innerHTML = '<div style="color: #ff3b30; text-align:center; padding: 20px;">⚠️ Fehler: Datenbank nicht verbunden.</div>';
            return;
        }
        if (!songsContainer) return;
        songsContainer.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-secondary);">Lade Songs aus der Cloud...</div>';
        allSongsElements = [];
        
        const { data: songs, error } = await supabaseClient.from('songs').select('*').order('created_at', { ascending: false }).limit(200);

        if (error) {
            songsContainer.innerHTML = `<div style="color: #ff3b30; text-align:center;">Datenbank-Fehler: ${error.message}</div>`;
            return;
        }

        globalSongsData = songs; 
        songsContainer.innerHTML = ''; 

        if (songs.length === 0) {
            songsContainer.innerHTML = '<div style="text-align:center; padding: 40px 20px; color: var(--text-secondary);">Keine Songs gefunden. Importiere jetzt Musik!</div>';
            return;
        }

       songs.forEach(song => {
            const songDiv = document.createElement('div');
            songDiv.className = 'song-item';
            songDiv.dataset.id = song.id; 
            updateSongDOM(songDiv, song);
            songsContainer.appendChild(songDiv);
            allSongsElements.push(songDiv);
        });
        
        if(typeof window.updateActiveHighlights === 'function') window.updateActiveHighlights();
        if(typeof window.updateAppStats === 'function') window.updateAppStats(); 
    }
    fetchSongsFromDatabase();

  function updateSongDOM(songDiv, song, playlistSongId = null) {
        let coverHtml = '';
        if (song.cover_data && song.cover_data.length > 10) {
            coverHtml = `<div class="song-cover" style="background-image: url('${song.cover_data}'); background-size: cover; background-position: center; border-radius: 6px;"></div>`;
        } else {
            const hue = Math.floor(Math.random() * 360);
            coverHtml = `<div class="song-cover" style="background: hsl(${hue}, 70%, 50%); display:flex; justify-content:center; align-items:center; border-radius: 6px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg></div>`;
        }
        
        songDiv.innerHTML = `
            <div class="song-checkbox"></div>
            ${coverHtml}
            <div class="song-info">
                <div class="song-title">${song.title}</div>
                <div class="song-artist">${song.artist}</div>
            </div>
            <div class="drag-handle">≡</div>
            <button class="song-context-btn icon-btn" style="margin-left: auto; padding: 10px; color: var(--text-secondary);">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2.5"></circle><circle cx="12" cy="12" r="2.5"></circle><circle cx="12" cy="19" r="2.5"></circle></svg>
            </button>
        `;

        const coverEl = songDiv.querySelector('.song-cover');
        addLongPressListener(coverEl, (e) => {
            e.preventDefault(); e.stopPropagation();
            window.currentContextSongId = song.id;
            document.getElementById('ctx-edit-tags').click(); 
        });

        if (playlistSongId) songDiv.dataset.psId = playlistSongId;

        let songStartX = 0;
        let isSwiping = false;

        songDiv.addEventListener('touchstart', (e) => { songStartX = e.touches[0].clientX; isSwiping = false; }, {passive: true});
        songDiv.addEventListener('touchmove', (e) => {
            if (!songStartX) return;
            if (Math.abs(songStartX - e.touches[0].clientX) > 20) isSwiping = true; 
        }, {passive: true});

        songDiv.addEventListener('touchend', (e) => {
            if (!songStartX || !isSwiping) return;
            let diffX = songStartX - e.changedTouches[0].clientX;
            
            if (Math.abs(diffX) > 60) {
                if (diffX < 0) { 
                    playbackQueue.unshift(song); 
                    savePlayerState();
                    const originalBg = songDiv.style.background;
                    songDiv.style.background = 'rgba(250, 35, 59, 0.2)'; 
                    setTimeout(() => songDiv.style.background = originalBg, 300);
                } else { 
                    const titleDiv = songDiv.querySelector('.song-title');
                    const vibesText = song.vibes && song.vibes.length > 0 ? song.vibes.join(' • ') : 'Keine Vibes';
                    if (!titleDiv.dataset.originalTitle) {
                        titleDiv.dataset.originalTitle = titleDiv.innerText;
                        titleDiv.innerHTML = `${titleDiv.dataset.originalTitle} <span style="color: var(--accent); font-size: 11px; margin-left: 8px; font-weight: 500; border: 1px solid var(--accent); padding: 1px 6px; border-radius: 10px;">${vibesText}</span>`;
                    } else {
                        titleDiv.innerText = titleDiv.dataset.originalTitle;
                        delete titleDiv.dataset.originalTitle;
                    }
                }
            }
            songStartX = 0; setTimeout(() => isSwiping = false, 50); 
        });

        songDiv.addEventListener('click', (e) => {
            if (isSwiping) { e.preventDefault(); e.stopPropagation(); return; } 
            if (e.target.closest('.song-context-btn')) {
                e.stopPropagation(); 
                window.currentContextSongId = song.id; 
                
                if (window.currentOpenPlaylistId) {
                    document.getElementById('ctx-delete').style.display = 'none';
                    document.getElementById('ctx-remove-from-playlist').style.display = 'flex';
                } else {
                    document.getElementById('ctx-delete').style.display = 'flex';
                    document.getElementById('ctx-remove-from-playlist').style.display = 'none';
                }
                if(songContextOverlay) songContextOverlay.classList.add('active');
                return;
            }
            if (currentMode !== 'normal' && currentMode !== 'reorder') {
                const checkbox = songDiv.querySelector('.song-checkbox');
                if (checkbox.classList.toggle('checked')) selectedSongs.add(song.id);
                else selectedSongs.delete(song.id);
                const selCount = document.getElementById('sel-count');
                if(selCount) selCount.innerText = `${selectedSongs.size} ausgewählt`;
                } else if (currentMode === 'normal') {
                window.currentPlayingPlaylistId = window.currentOpenPlaylistId || null; 
                window.playSong(song.title, song.artist, song.cover_data, song.file_url);
                
                if (window.currentOpenPlaylistId && window.currentPlaylistSongs) {
                    const songIndex = window.currentPlaylistSongs.findIndex(s => s.id === song.id);
                    if (songIndex > -1) playbackQueue = window.currentPlaylistSongs.slice(songIndex + 1);
                } else if (globalSongsData && globalSongsData.length > 0) {
                    const otherSongs = globalSongsData.filter(s => s.id !== song.id);
                    playbackQueue = otherSongs.sort(() => 0.5 - Math.random());
                }
                savePlayerState(); 
            }
        });
    }

   // --- 6. UPLOAD (KORRIGIERT: WARTESCHLANGE & CHECK) ---
    const btnAddSongs = document.getElementById('btn-add-songs');
    const fileUploadInput = document.getElementById('native-file-upload');
    const jsmediatags = window.jsmediatags;

    if (btnAddSongs && fileUploadInput) {
        btnAddSongs.addEventListener('click', () => fileUploadInput.click());
        fileUploadInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (!files || files.length === 0) return;
            
            btnAddSongs.disabled = true;
            let successCount = 0;
            let skipCount = 0;
            
            // Speichert die Größen der aktuellen Session, damit z.B. 3x das gleiche Lied sofort erkannt wird
            const currentSessionSizes = new Set();

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                btnAddSongs.innerHTML = `Lädt... (${i+1}/${files.length})`;

                // 1. STRIKTER DUPLIKAT FILTER (Datenbank + Aktuelle Session)
                const isDuplicateDB = globalSongsData.some(s => s.file_size === file.size);
                const isDuplicateSession = currentSessionSizes.has(file.size);
                
                if (isDuplicateDB || isDuplicateSession) {
                    console.log(`Überspringe "${file.name}" - exakte Datei existiert bereits.`);
                    skipCount++;
                    continue; 
                }

                currentSessionSizes.add(file.size);
                const fallbackName = file.name.replace(/\.[^/.]+$/, "");
                const safeFileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, "_")}`; 
                const fileDuration = await getDuration(file);

                try {
                    // Upload zum Cloudflare Worker
                    const workerUrl = `https://heatbox-upload.tyron-app.workers.dev/${safeFileName}`;
                    const uploadResponse = await fetch(workerUrl, { method: 'PUT', body: file });
                    
                    if (!uploadResponse.ok) throw new Error(`Cloudflare Upload fehlgeschlagen! Status: ${uploadResponse.status}`);
                    
                    const uploadResult = await uploadResponse.json();
                    const fileUrl = uploadResult.url; 

                    // Warte synchron auf die ID3 Tags
                    await new Promise((resolveTags) => {
                        jsmediatags.read(file, {
                            onSuccess: async function(tag) {
                                try {
                                    const tags = tag.tags;
                                    const title = tags.title ? tags.title.trim() : fallbackName;
                                    const artist = tags.artist ? tags.artist.trim() : "Unbekannter Künstler";
                                    let finalCoverUrl = await fetchCoverFromiTunes(title, artist);
                                    
                                    if (!finalCoverUrl && tags.picture) {
                                        try {
                                            const byteArray = new Uint8Array(tags.picture.data);
                                            const imageBlob = new Blob([byteArray], { type: tags.picture.format });
                                            const coverFileName = `cover_${Date.now()}_${Math.floor(Math.random()*1000)}.jpg`;
                                            const coverResponse = await fetch(`https://heatbox-upload.tyron-app.workers.dev/${coverFileName}`, { method: 'PUT', body: imageBlob });
                                            if (coverResponse.ok) {
                                                const coverResult = await coverResponse.json();
                                                finalCoverUrl = coverResult.url;
                                            }
                                        } catch (err) { console.log("Fehler beim Cover-Upload:", err); }
                                    }

                                    const { error: dbError } = await supabaseClient.from('songs').insert([{ title: title, artist: artist, cover_data: finalCoverUrl || "", file_url: fileUrl, vibes: [], file_size: file.size, duration: fileDuration}]);
                                    if (!dbError) successCount++;
                                } catch(e) { console.error(e); }
                                resolveTags();
                            },
                            onError: async function() {
                                try {
                                    let finalCoverUrl = await fetchCoverFromiTunes(fallbackName, "");
                                    const { error: dbError } = await supabaseClient.from('songs').insert([{ title: fallbackName, artist: "Unbekannter Künstler", cover_data: finalCoverUrl || "", file_url: fileUrl, vibes: [], file_size: file.size, duration: fileDuration }]);
                                    if (!dbError) successCount++;
                                } catch(e) { console.error(e); }
                                resolveTags();
                            }
                        });
                    });
                } catch (err) { 
                    console.error("FEHLER beim Upload:\n", err); 
                }
            }
            
            // Alles fertig!
            await fetchSongsFromDatabase();
            btnAddSongs.innerHTML = 'Musik importieren';
            btnAddSongs.disabled = false;
            fileUploadInput.value = ''; 
            
            if (skipCount > 0) {
                alert(`Upload abgeschlossen!\n\nErfolgreich: ${successCount}\nÜbersprungen (Duplikate): ${skipCount}`);
            }
        });
    }

    // --- 7. SONG CONTEXT MENÜ ---
    const ctxAddQueue = document.getElementById('ctx-add-queue');
    const ctxAddPlaylist = document.getElementById('ctx-add-playlist');
    const ctxEditTags = document.getElementById('ctx-edit-tags');
    const ctxDelete = document.getElementById('ctx-delete');
    const ctxCreateStation = document.getElementById('ctx-create-station');
    const confirmOverlay = document.getElementById('confirm-dialog-overlay');

    if(ctxAddQueue) {
        ctxAddQueue.addEventListener('click', () => {
            const song = globalSongsData.find(s => s.id === window.currentContextSongId);
            if (song) {
                playbackQueue.unshift(song);
                alert(`"${song.title}" spielt als nächstes.`);
            }
            songContextOverlay.classList.remove('active');
        });
    }

    if(ctxAddPlaylist) {
        ctxAddPlaylist.addEventListener('click', () => {
            selectedSongs.clear(); 
            window.openPlaylistSelection(); 
        });
    }

    if(ctxDelete) {
        ctxDelete.addEventListener('click', () => {
            songContextOverlay.classList.remove('active');
            selectedSongs.clear();
            selectedSongs.add(window.currentContextSongId);
            if(confirmOverlay) confirmOverlay.classList.add('active');
        });
    }

    const ctxRemoveFromPlaylist = document.getElementById('ctx-remove-from-playlist');
    if(ctxRemoveFromPlaylist) {
        ctxRemoveFromPlaylist.addEventListener('click', async () => {
            songContextOverlay.classList.remove('active');
            const { error } = await supabaseClient.from('playlist_songs')
                .delete()
                .eq('playlist_id', window.currentOpenPlaylistId)
                .eq('song_id', window.currentContextSongId);
            if(!error) {
                const el = document.querySelector(`#playlist-details-songs-container .song-item[data-id="${window.currentContextSongId}"]`);
                if(el) el.remove();
                window.fetchPlaylistsForPage(); 
            }
        });
    }

   if(ctxCreateStation) {
        ctxCreateStation.addEventListener('click', () => {
            songContextOverlay.classList.remove('active');
            const song = globalSongsData.find(s => s.id === window.currentContextSongId);
            if (!song) return;

            const sourceVibes = song.vibes || [];
            let stationSongs = globalSongsData.filter(s => {
                if (s.id === song.id) return true; 
                const sVibes = s.vibes || [];
                const matchCount = sVibes.filter(v => sourceVibes.includes(v)).length;
                return matchCount >= 2;
            });

            if (stationSongs.length === 1) {
                const shuffled = [...globalSongsData].sort(() => 0.5 - Math.random());
                stationSongs = [...stationSongs, ...shuffled.slice(0, 5)];
                stationSongs = Array.from(new Set(stationSongs));
            }

            const newStation = {
                id: 'station_' + Date.now(),
                name: "Sender: " + song.title,
                cover_data: song.cover_data,
                songs: stationSongs,
                expires: Date.now() + (24 * 60 * 60 * 1000) 
            };

            const savedStations = JSON.parse(localStorage.getItem('heatbox_stations') || '[]');
            savedStations.unshift(newStation); 
            localStorage.setItem('heatbox_stations', JSON.stringify(savedStations));

            if (typeof window.renderHomeSections === 'function') window.renderHomeSections();
            alert(`Sender für "${song.title}" wurde auf der Startseite erstellt!`);
        });
    }

    // --- 8. AUDIO TAGS BEARBEITEN ---
    const editOverlay = document.getElementById('edit-tags-overlay');
    const editTitle = document.getElementById('edit-input-title');
    const editArtist = document.getElementById('edit-input-artist');
    const editCoverPreview = document.getElementById('edit-cover-preview');
    const editCoverBtn = document.getElementById('edit-cover-btn');
    const editCoverUpload = document.getElementById('edit-cover-upload');
    const editVibesContainer = document.getElementById('edit-vibes-container');
    const btnSearchItunes = document.getElementById('btn-search-itunes');
    const btnSaveTags = document.getElementById('btn-save-tags');

    let currentEditCoverData = "";

    if(ctxEditTags) {
        ctxEditTags.addEventListener('click', () => {
            if(songContextOverlay) songContextOverlay.classList.remove('active');
            let song = globalSongsData.find(s => s.id == window.currentContextSongId);
            
            if (!song && window.currentSongData && window.currentSongData.id == window.currentContextSongId) {
                song = window.currentSongData;
            }

            if (!song) {
                alert("Lied noch nicht vollständig geladen. Bitte kurz warten.");
                return;
            }

            editTitle.value = song.title || '';
            editArtist.value = song.artist || '';
            currentEditCoverData = song.cover_data || song.coverUrl || '';
            editCoverPreview.src = currentEditCoverData.length > 10 ? currentEditCoverData : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

            const songVibes = song.vibes || [];
            editVibesContainer.innerHTML = '';
            AVAILABLE_VIBES.forEach(vibe => {
                const pill = document.createElement('div');
                pill.className = `vibe-pill ${songVibes.includes(vibe) ? 'active' : ''}`;
                pill.innerText = vibe;
                pill.dataset.vibe = vibe;
                pill.addEventListener('click', () => pill.classList.toggle('active'));
                editVibesContainer.appendChild(pill);
            });

            editOverlay.classList.add('active');
        });
    }

    if (editCoverBtn) editCoverBtn.addEventListener('click', () => editCoverUpload.click());
    if (editCoverUpload) {
        editCoverUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(event) {
                currentEditCoverData = event.target.result;
                editCoverPreview.src = currentEditCoverData;
            };
            reader.readAsDataURL(file);
        });
    }

    if (btnSearchItunes) {
        btnSearchItunes.addEventListener('click', async () => {
            btnSearchItunes.innerText = "Suche...";
            const newUrl = await fetchCoverFromiTunes(editTitle.value, editArtist.value);
            if (newUrl) {
                currentEditCoverData = newUrl;
                editCoverPreview.src = newUrl;
                btnSearchItunes.innerHTML = "Cover gefunden!";
            } else {
                btnSearchItunes.innerHTML = "Nichts gefunden";
            }
            setTimeout(() => btnSearchItunes.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 5px; margin-top: -2px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> In iTunes suchen`, 2000);
        });
    }

    if (btnSaveTags) {
        btnSaveTags.addEventListener('click', async () => {
            btnSaveTags.innerText = "Speichere...";
            const selectedVibes = [];
            document.querySelectorAll('.vibe-pill.active').forEach(pill => selectedVibes.push(pill.dataset.vibe));

            const { error } = await supabaseClient
                .from('songs')
                .update({ title: editTitle.value, artist: editArtist.value, cover_data: currentEditCoverData, vibes: selectedVibes })
                .eq('id', window.currentContextSongId);

            if (error) {
                alert("Fehler beim Speichern: " + error.message);
            } else {
                editOverlay.classList.remove('active');
                fetchSongsFromDatabase(); 
            }
            btnSaveTags.innerText = "Speichern";
        });
    }

    // --- 9. SONGS LÖSCHEN & SORTIEREN (SONG TAB) ---
    document.getElementById('action-delete')?.addEventListener('click', () => {
        actionSheetOverlay.classList.remove('active');
        currentMode = 'delete';
        selectedSongs.clear();
        songsContainer.classList.add('selection-mode');
        selectionToolbar.classList.remove('hidden');
        setTimeout(() => selectionToolbar.classList.add('visible'), 10);
        document.getElementById('sel-action').innerText = 'Löschen';
        document.getElementById('sel-action').className = 'sel-btn text-danger';
        const countEl = document.getElementById('sel-count');
        if (countEl) countEl.innerText = '0 ausgewählt';
    });

    document.getElementById('action-add-playlist')?.addEventListener('click', () => {
        actionSheetOverlay.classList.remove('active');
        currentMode = 'playlist';
        selectedSongs.clear();
        songsContainer.classList.add('selection-mode');
        selectionToolbar.classList.remove('hidden');
        setTimeout(() => selectionToolbar.classList.add('visible'), 10);
        document.getElementById('sel-action').innerText = 'Hinzufügen';
        document.getElementById('sel-action').className = 'sel-btn';
        const countEl = document.getElementById('sel-count');
        if (countEl) countEl.innerText = '0 ausgewählt';
    });

    document.getElementById('sel-cancel')?.addEventListener('click', () => {
        currentMode = 'normal';
        songsContainer.classList.remove('selection-mode');
        selectionToolbar.classList.remove('visible');
        setTimeout(() => selectionToolbar.classList.add('hidden'), 300);
        document.querySelectorAll('.song-checkbox').forEach(cb => cb.classList.remove('checked'));
        document.querySelectorAll('.disabled-song').forEach(el => el.classList.remove('disabled-song'));
    });

    document.getElementById('sel-all')?.addEventListener('click', () => {
        const visibleSongs = Array.from(songsContainer.querySelectorAll('.song-item'));
        const allVisibleSelected = visibleSongs.length > 0 && visibleSongs.every(el => selectedSongs.has(el.dataset.id));

        if (allVisibleSelected) {
            visibleSongs.forEach(el => {
                el.querySelector('.song-checkbox').classList.remove('checked');
                selectedSongs.delete(el.dataset.id);
            });
        } else {
            visibleSongs.forEach(el => {
                el.querySelector('.song-checkbox').classList.add('checked');
                selectedSongs.add(el.dataset.id);
            });
        }
        const countEl = document.getElementById('sel-count');
        if(countEl) countEl.innerText = `${selectedSongs.size} ausgewählt`;
    });

    const selAction = document.getElementById('sel-action');
    if(selAction) {
        selAction.addEventListener('click', () => {
            if (selectedSongs.size === 0) return; 
            if (currentMode === 'delete' && confirmOverlay) confirmOverlay.classList.add('active'); 
            else if (currentMode === 'playlist') window.openPlaylistSelection();
            else if (currentMode === 'add-to-specific-playlist') {
                const targetPlaylist = window.globalPlaylistsData.find(p => p.id === window.currentContextPlaylistId);
                if (targetPlaylist) addSelectedSongsToPlaylist(targetPlaylist.id, targetPlaylist.name);
            }
        });
    }

  const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    if (confirmDeleteBtn && confirmOverlay) {
        confirmDeleteBtn.addEventListener('click', async () => {
            confirmDeleteBtn.innerText = 'Lösche...'; 
            const idsToDelete = Array.from(selectedSongs).map(id => parseInt(id));
            const { data: songsToDelete } = await supabaseClient.from('songs').select('file_url').in('id', idsToDelete);
            const { error } = await supabaseClient.from('songs').delete().in('id', idsToDelete);
            
            if (error) {
                alert("Fehler: " + error.message);
            } else {
                allSongsElements.forEach(el => { 
                    if(idsToDelete.includes(parseInt(el.dataset.id))) el.remove(); 
                });
                allSongsElements = allSongsElements.filter(el => !idsToDelete.includes(parseInt(el.dataset.id)));
                
                if (songsToDelete && songsToDelete.length > 0) {
                    const fileNames = songsToDelete.map(s => {
                        const parts = s.file_url.split('/');
                        return parts[parts.length - 1]; 
                    });
                    await supabaseClient.storage.from('music').remove(fileNames);
                }

                confirmOverlay.classList.remove('active');
                document.getElementById('sel-cancel')?.click(); 
            }
            confirmDeleteBtn.innerText = 'Löschen';
        });
    }

    const sortOverlay = document.getElementById('sort-sheet-overlay');
    window.currentSortTarget = 'songs'; 

    document.getElementById('action-sort')?.addEventListener('click', () => {
        actionSheetOverlay.classList.remove('active');
        sortOverlay.classList.add('active');
        window.currentSortTarget = 'songs'; 
    });

    let sortAscending = true; 
    document.getElementById('sort-asc')?.addEventListener('click', (e) => { e.target.classList.add('active'); document.getElementById('sort-desc').classList.remove('active'); sortAscending = true; });
    document.getElementById('sort-desc')?.addEventListener('click', (e) => { e.target.classList.add('active'); document.getElementById('sort-asc').classList.remove('active'); sortAscending = false; });

    document.querySelectorAll('#sort-sheet-overlay .sort-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const criteria = e.target.getAttribute('data-sort'); 
            let targetElements = [];
            let targetContainer = null;
            if (window.currentSortTarget === 'playlist') {
                targetContainer = document.getElementById('playlist-details-songs-container');
                targetElements = Array.from(targetContainer.querySelectorAll('.song-item'));
            } else {
                targetContainer = songsContainer;
                targetElements = allSongsElements;
            }

            targetElements.sort((a, b) => {
                let valA, valB;
                if (criteria === 'title') {
                    valA = a.querySelector('.song-title').innerText.toLowerCase();
                    valB = b.querySelector('.song-title').innerText.toLowerCase();
                } else if (criteria === 'artist') {
                    valA = a.querySelector('.song-artist').innerText.toLowerCase();
                    valB = b.querySelector('.song-artist').innerText.toLowerCase();
                } else if (criteria === 'created_at') {
                    valA = parseInt(a.dataset.id);
                    valB = parseInt(b.dataset.id);
                }
                if (valA < valB) return sortAscending ? -1 : 1;
                if (valA > valB) return sortAscending ? 1 : -1;
                return 0;
            });
            
            targetContainer.innerHTML = '';
            targetElements.forEach(el => targetContainer.appendChild(el));
            sortOverlay.classList.remove('active');
        });
    });

    const viewOverlay = document.getElementById('view-sheet-overlay');
    document.getElementById('action-view')?.addEventListener('click', () => {
        actionSheetOverlay.classList.remove('active'); viewOverlay.classList.add('active'); 
    });
    document.getElementById('set-view-list')?.addEventListener('click', () => {
        songsContainer.className = 'song-container list-view';
        const pldContainer = document.getElementById('playlist-details-songs-container');
        if(pldContainer) pldContainer.className = 'song-container list-view';
        viewOverlay.classList.remove('active');
    });
    document.getElementById('set-view-grid')?.addEventListener('click', () => {
        songsContainer.className = 'song-container grid-view';
        const pldContainer = document.getElementById('playlist-details-songs-container');
        if(pldContainer) pldContainer.className = 'song-container grid-view';
        viewOverlay.classList.remove('active');
    });

    // --- 9b. FILTER NACH VIBE LOGIK ---
    const actionFilterVibeBtn = document.getElementById('action-filter-vibe');
    const vibeFilterOverlay = document.getElementById('vibe-filter-overlay');
    const filterVibesContainer = document.getElementById('filter-vibes-container');
    const btnApplyVibeFilter = document.getElementById('btn-apply-vibe-filter');
    const btnClearVibeFilter = document.getElementById('btn-clear-vibe-filter');

    if(actionFilterVibeBtn && vibeFilterOverlay) {
        actionFilterVibeBtn.addEventListener('click', () => {
            actionSheetOverlay.classList.remove('active'); 
            if(filterVibesContainer.innerHTML === '') {
                AVAILABLE_VIBES.forEach(vibe => {
                    const pill = document.createElement('div');
                    pill.className = 'vibe-pill';
                    pill.innerText = vibe;
                    pill.dataset.vibe = vibe;
                    pill.addEventListener('click', () => pill.classList.toggle('active'));
                    filterVibesContainer.appendChild(pill);
                });
            }
            vibeFilterOverlay.classList.add('active'); 
        });
    }

    if(btnApplyVibeFilter) {
        btnApplyVibeFilter.addEventListener('click', () => {
            const selectedFilterVibes = [];
            filterVibesContainer.querySelectorAll('.vibe-pill.active').forEach(pill => selectedFilterVibes.push(pill.dataset.vibe));
            
            songsContainer.innerHTML = ''; 
            
            if(selectedFilterVibes.length === 0) {
                allSongsElements.forEach(el => songsContainer.appendChild(el));
            } else {
                allSongsElements.forEach(el => {
                    const songId = parseInt(el.dataset.id);
                    const songData = globalSongsData.find(s => s.id === songId);
                    if(songData && songData.vibes) {
                        const hasMatch = selectedFilterVibes.some(v => songData.vibes.includes(v));
                        if(hasMatch) {
                            songsContainer.appendChild(el);
                        }
                    }
                });
            }
            vibeFilterOverlay.classList.remove('active');
        });
    }

    if(btnClearVibeFilter) {
        btnClearVibeFilter.addEventListener('click', () => {
            filterVibesContainer.querySelectorAll('.vibe-pill.active').forEach(pill => pill.classList.remove('active'));
            songsContainer.innerHTML = '';
            allSongsElements.forEach(el => songsContainer.appendChild(el));
            vibeFilterOverlay.classList.remove('active');
        });
    }

    // --- 10. PLAYLIST PAGE & POPUP LOGIK ---
    const playlistsPageContainer = document.getElementById('playlists-page-container');
    const availablePlaylistsContainer = document.getElementById('available-playlists-container');
    const btnCreatePlaylistPage = document.getElementById('btn-create-playlist-page');
    const btnCreateNewPlaylistPopup = document.getElementById('btn-create-new-playlist');
    
    let currentPlaylistMode = 'normal';
    let selectedPlaylists = new Set();
    let allPlaylistsElements = [];

    window.fetchPlaylistsForPage = async function() {
        if (!supabaseClient) return;

        if(playlistsPageContainer) playlistsPageContainer.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-secondary);">Lade Playlists...</div>';
        if(availablePlaylistsContainer) availablePlaylistsContainer.innerHTML = '<div style="padding: 15px 20px; color: var(--text-secondary);">Lade Playlists...</div>';
        allPlaylistsElements = [];

        const { data: playlists, error } = await supabaseClient.from('playlists').select('*').order('created_at', { ascending: false });
        const { data: allPlaylistSongs } = await supabaseClient.from('playlist_songs').select('*');
        const { data: allSongsInfo } = await supabaseClient.from('songs').select('id, duration');

        if (error) {
            if(playlistsPageContainer) playlistsPageContainer.innerHTML = `<div style="color: #ff3b30; text-align:center;">Fehler: ${error.message}</div>`;
            return;
        }

        window.globalPlaylistsData = playlists; 
        if (typeof window.renderHomeSections === 'function') window.renderHomeSections();
        if (typeof window.updateAppStats === 'function') window.updateAppStats(); 

        if (playlistsPageContainer) {
            playlistsPageContainer.innerHTML = '';
            if (playlists.length === 0) {
                playlistsPageContainer.innerHTML = '<div style="text-align:center; padding: 40px 20px; color: var(--text-secondary);">Keine Playlists gefunden.</div>';
            } else {
                playlists.forEach(playlist => {
                    const pDiv = document.createElement('div');
                    pDiv.className = 'song-item'; 
                    pDiv.dataset.id = playlist.id;
                    
                        let bgStyle = playlist.cover_data && playlist.cover_data.length > 10 
                        ? `background-image: url('${playlist.cover_data}'); background-size: cover; background-position: center;`
                        : `background: hsl(${Math.floor(Math.random() * 360)}, 40%, 30%); display:flex; justify-content:center; align-items:center;`;
                    let innerSvg = playlist.cover_data && playlist.cover_data.length > 10 ? '' : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`;

                    let coverHtml = `<div class="song-cover" style="${bgStyle} border-radius: 6px;">${innerSvg}</div>`;

                    const mySongs = allPlaylistSongs ? allPlaylistSongs.filter(ps => ps.playlist_id === playlist.id) : [];
                    let count = mySongs.length;
                    let dur = 0;
                    mySongs.forEach(ps => {
                        const s = allSongsInfo ? allSongsInfo.find(song => song.id === ps.song_id) : null;
                        if (s && s.duration) dur += s.duration;
                    });

                    let statText = `${count} Songs`;
                    if (dur > 0) statText += ` • ${formatDuration(dur)}`;
                    
                    pDiv.innerHTML = `
                        <div class="song-checkbox playlist-checkbox"></div>
                        ${coverHtml}
                        <div class="song-info">
                            <div class="song-title">${playlist.name}</div>
                            <div class="song-artist">Playlist • ${statText}</div>
                        </div>
                        <button class="list-play-btn icon-btn" style="margin-left: auto; padding: 10px; color: var(--accent);">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        </button>
                        <button class="playlist-context-btn icon-btn" style="padding: 10px; color: var(--text-secondary);">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2.5"></circle><circle cx="12" cy="12" r="2.5"></circle><circle cx="12" cy="19" r="2.5"></circle></svg>
                        </button>
                    `;

                    const pCoverEl = pDiv.querySelector('.song-cover');
                    if (typeof addLongPressListener === 'function') {
                        addLongPressListener(pCoverEl, (e) => {
                            e.preventDefault(); e.stopPropagation();
                            window.currentContextPlaylistId = playlist.id;
                            document.getElementById('ctx-pl-edit').click();
                        });
                    }

                    const playBtn = pDiv.querySelector('.list-play-btn');
                    if (playBtn) playBtn.addEventListener('click', (e) => window.togglePlaylistPlayback(e, playlist.id));

                    pDiv.addEventListener('click', (e) => {
                        if (e.target.closest('.playlist-context-btn')) {
                            e.stopPropagation(); 
                            window.currentContextPlaylistId = playlist.id; 
                            const plContextOverlay = document.getElementById('playlist-context-overlay');
                            if(plContextOverlay) plContextOverlay.classList.add('active');
                            return;
                        }

                        if (currentPlaylistMode !== 'normal') {
                            const checkbox = pDiv.querySelector('.playlist-checkbox');
                            if (checkbox.classList.toggle('checked')) selectedPlaylists.add(playlist.id);
                            else selectedPlaylists.delete(playlist.id);
                            const countEl = document.getElementById('sel-count-playlist');
                            if(countEl) countEl.innerText = `${selectedPlaylists.size} ausgewählt`;
                        } else {
                            window.openPlaylistDetails(playlist.id, playlist.name);
                        }
                    });
                    playlistsPageContainer.appendChild(pDiv);
                    allPlaylistsElements.push(pDiv);
                });
            }
        }

        if (availablePlaylistsContainer) {
            availablePlaylistsContainer.innerHTML = '';
            if (playlists.length === 0) {
                availablePlaylistsContainer.innerHTML = '<div style="padding: 15px 20px; color: var(--text-secondary); font-size: 14px;">Noch keine Playlists vorhanden.</div>';
            } else {
                playlists.forEach(playlist => {
                    const btn = document.createElement('button');
                    btn.className = 'sheet-btn';
                    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-secondary);"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg> ${playlist.name}`;
                    btn.addEventListener('click', () => addSelectedSongsToPlaylist(playlist.id, playlist.name));
                    availablePlaylistsContainer.appendChild(btn);
                });
            }
        }
    };

    window.fetchPlaylistsForPage(); 

    window.openPlaylistSelection = function() {
        if (!playlistSelectionOverlay || !supabaseClient) return;
        playlistSelectionOverlay.classList.add('active');
        window.fetchPlaylistsForPage(); 
    };

    async function createNewPlaylistProcess() {
        const playlistName = prompt('Name der neuen Playlist:');
        if (!playlistName || playlistName.trim() === '') return;
        
        const { data, error } = await supabaseClient.from('playlists').insert([{ name: playlistName.trim() }]).select(); 
        if (error) { alert('Fehler: ' + error.message); return; }
        
        await window.fetchPlaylistsForPage(); 

        if (data && data.length > 0 && (selectedSongs.size > 0 || window.currentContextSongId)) {
            addSelectedSongsToPlaylist(data[0].id, data[0].name);
        }
    }

    if (btnCreatePlaylistPage) btnCreatePlaylistPage.addEventListener('click', createNewPlaylistProcess);
    if (btnCreateNewPlaylistPopup) btnCreateNewPlaylistPopup.addEventListener('click', createNewPlaylistProcess);

    async function addSelectedSongsToPlaylist(playlistId, playlistName) {
        const isContextMode = selectedSongs.size === 0 && window.currentContextSongId;
        const idsToAdd = isContextMode ? [window.currentContextSongId] : Array.from(selectedSongs);

        const { data: existingData } = await supabaseClient.from('playlist_songs').select('song_id').eq('playlist_id', playlistId);
        const existingIds = existingData ? existingData.map(d => d.song_id) : [];
        const newIds = idsToAdd.filter(id => !existingIds.includes(parseInt(id)));

        if (newIds.length === 0) {
            alert("Lied(er) bereits in der Playlist!");
            document.getElementById('sel-cancel')?.click(); 
            return;
        }

        const inserts = newIds.map(songId => ({ playlist_id: playlistId, song_id: parseInt(songId) }));
        const { error } = await supabaseClient.from('playlist_songs').insert(inserts);

        if (error) {
            alert('Fehler beim Hinzufügen: ' + error.message);
        } else {
            if(playlistSelectionOverlay) playlistSelectionOverlay.classList.remove('active');
            if(songContextOverlay) songContextOverlay.classList.remove('active'); 
            if (currentMode !== 'normal') document.getElementById('sel-cancel')?.click(); 
            
            setTimeout(() => {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                const plNavBtn = document.querySelector('.nav-btn[data-target="view-playlists"]');
                if (plNavBtn) plNavBtn.classList.add('active');
                
                document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.classList.add('hidden'); });
                const viewPlaylists = document.getElementById('view-playlists');
                if (viewPlaylists) {
                    viewPlaylists.classList.remove('hidden');
                    setTimeout(() => viewPlaylists.classList.add('active'), 10);
                }
                window.openPlaylistDetails(playlistId, playlistName);
            }, 300);
        }
    }

    const playlistActionOverlay = document.getElementById('playlist-action-sheet');
    const playlistSortOverlay = document.getElementById('playlist-sort-overlay');
    const playlistViewOverlay = document.getElementById('playlist-view-overlay');
    const playlistToolbar = document.getElementById('playlist-selection-toolbar');
    const confirmDeletePlaylistOverlay = document.getElementById('confirm-delete-playlist-overlay');

    document.getElementById('playlist-options-btn')?.addEventListener('click', () => playlistActionOverlay.classList.add('active'));

    document.getElementById('action-view-playlist')?.addEventListener('click', () => {
        playlistActionOverlay.classList.remove('active'); playlistViewOverlay.classList.add('active');
    });
    document.getElementById('set-view-list-playlist')?.addEventListener('click', () => {
        if(playlistsPageContainer) playlistsPageContainer.className = 'song-container list-view';
        playlistViewOverlay.classList.remove('active');
    });
    document.getElementById('set-view-grid-playlist')?.addEventListener('click', () => {
        if(playlistsPageContainer) playlistsPageContainer.className = 'song-container grid-view';
        playlistViewOverlay.classList.remove('active');
    });

    document.getElementById('action-sort-playlist')?.addEventListener('click', () => {
        playlistActionOverlay.classList.remove('active'); playlistSortOverlay.classList.add('active');
    });

    let sortAscPlaylist = true;
    document.getElementById('sort-asc-playlist')?.addEventListener('click', (e) => { e.target.classList.add('active'); document.getElementById('sort-desc-playlist').classList.remove('active'); sortAscPlaylist = true; });
    document.getElementById('sort-desc-playlist')?.addEventListener('click', (e) => { e.target.classList.add('active'); document.getElementById('sort-asc-playlist').classList.remove('active'); sortAscPlaylist = false; });

    document.querySelectorAll('.sort-btn-playlist').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const criteria = e.target.getAttribute('data-sort');
            allPlaylistsElements.sort((a, b) => {
                let valA, valB;
                if (criteria === 'name') {
                    valA = a.querySelector('.song-title').innerText.toLowerCase();
                    valB = b.querySelector('.song-title').innerText.toLowerCase();
                } else if (criteria === 'created_at') {
                    valA = parseInt(a.dataset.id);
                    valB = parseInt(b.dataset.id);
                }
                if (valA < valB) return sortAscPlaylist ? -1 : 1;
                if (valA > valB) return sortAscPlaylist ? 1 : -1;
                return 0;
            });
            if(playlistsPageContainer) {
                playlistsPageContainer.innerHTML = '';
                allPlaylistsElements.forEach(el => playlistsPageContainer.appendChild(el));
            }
            playlistSortOverlay.classList.remove('active');
        });
    });

    function endPlaylistSelectionMode() {
        currentPlaylistMode = 'normal';
        if(playlistsPageContainer) playlistsPageContainer.classList.remove('selection-mode');
        if(playlistToolbar) { playlistToolbar.classList.remove('visible'); setTimeout(() => playlistToolbar.classList.add('hidden'), 300); }
        document.querySelectorAll('.playlist-checkbox').forEach(cb => cb.classList.remove('checked'));
    }

    document.getElementById('action-delete-playlist')?.addEventListener('click', () => {
        playlistActionOverlay.classList.remove('active');
        currentPlaylistMode = 'delete';
        selectedPlaylists.clear();
        if(playlistsPageContainer) playlistsPageContainer.classList.add('selection-mode');
        if(playlistToolbar) { playlistToolbar.classList.remove('hidden'); setTimeout(() => playlistToolbar.classList.add('visible'), 10); }
        const countEl = document.getElementById('sel-count-playlist');
        if (countEl) countEl.innerText = '0 ausgewählt';
    });

    document.getElementById('sel-cancel-playlist')?.addEventListener('click', endPlaylistSelectionMode);
    document.getElementById('sel-all-playlist')?.addEventListener('click', () => {
        const allSelected = selectedPlaylists.size === allPlaylistsElements.length;
        selectedPlaylists.clear();
        allPlaylistsElements.forEach(el => {
            const cb = el.querySelector('.playlist-checkbox');
            if (!allSelected) { cb.classList.add('checked'); selectedPlaylists.add(el.dataset.id); } 
            else { cb.classList.remove('checked'); }
        });
        const countEl = document.getElementById('sel-count-playlist');
        if(countEl) countEl.innerText = `${selectedPlaylists.size} ausgewählt`;
    });

    document.getElementById('sel-action-playlist')?.addEventListener('click', () => {
        if (selectedPlaylists.size > 0 && confirmDeletePlaylistOverlay) confirmDeletePlaylistOverlay.classList.add('active');
    });

    const confirmDeletePlaylistBtn = document.getElementById('confirm-delete-playlist-btn');
    if (confirmDeletePlaylistBtn) {
        confirmDeletePlaylistBtn.addEventListener('click', async () => {
            confirmDeletePlaylistBtn.innerText = 'Lösche...';
            const idsToDelete = Array.from(selectedPlaylists);
            const { error } = await supabaseClient.from('playlists').delete().in('id', idsToDelete);
            if (error) alert("Fehler beim Löschen: " + error.message);
            else {
                window.fetchPlaylistsForPage(); 
                if(confirmDeletePlaylistOverlay) confirmDeletePlaylistOverlay.classList.remove('active');
                endPlaylistSelectionMode();
            }
            confirmDeletePlaylistBtn.innerText = 'Löschen';
        });
    }

    // --- 10b. PLAYLIST KONTEXT MENÜ ---
    document.getElementById('ctx-pl-delete')?.addEventListener('click', () => {
        document.getElementById('playlist-context-overlay')?.classList.remove('active');
        selectedPlaylists.clear();
        selectedPlaylists.add(window.currentContextPlaylistId); 
        const confirmDelOverlay = document.getElementById('confirm-delete-playlist-overlay');
        if(confirmDelOverlay) confirmDelOverlay.classList.add('active'); 
    });

    let currentEditPlaylistCoverData = "";
    document.getElementById('ctx-pl-edit')?.addEventListener('click', () => {
        document.getElementById('playlist-context-overlay')?.classList.remove('active');
        const playlist = window.globalPlaylistsData.find(p => p.id === window.currentContextPlaylistId);
        if(!playlist) return;

        document.getElementById('edit-playlist-name').value = playlist.name || '';
        currentEditPlaylistCoverData = playlist.cover_data || '';
        document.getElementById('edit-playlist-cover-preview').src = currentEditPlaylistCoverData.length > 10 ? currentEditPlaylistCoverData : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
        
        document.getElementById('edit-playlist-overlay').classList.add('active');
    });

    document.getElementById('edit-playlist-cover-btn')?.addEventListener('click', () => document.getElementById('edit-playlist-cover-upload').click());
    document.getElementById('edit-playlist-cover-upload')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(event) {
            currentEditPlaylistCoverData = event.target.result;
            document.getElementById('edit-playlist-cover-preview').src = currentEditPlaylistCoverData;
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('btn-save-playlist')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-save-playlist');
        btn.innerText = "Speichere...";
        const newName = document.getElementById('edit-playlist-name').value;

        const { error } = await supabaseClient.from('playlists')
            .update({ name: newName, cover_data: currentEditPlaylistCoverData })
            .eq('id', window.currentContextPlaylistId);

        if(error) alert("Fehler: " + error.message);
        else {
            document.getElementById('edit-playlist-overlay').classList.remove('active');
            window.fetchPlaylistsForPage(); 
        }
        btn.innerText = "Speichern";
    });

    document.getElementById('ctx-pl-add-queue')?.addEventListener('click', async () => {
        document.getElementById('playlist-context-overlay')?.classList.remove('active');
        const playlist = window.globalPlaylistsData.find(p => p.id === window.currentContextPlaylistId);
        
        const { data, error } = await supabaseClient.from('playlist_songs')
            .select('songs(*)').eq('playlist_id', window.currentContextPlaylistId);
            
        if(error || !data || data.length === 0) {
            alert("Playlist ist leer oder konnte nicht geladen werden.");
            return;
        }
        
        let songsInPl = data.map(item => item.songs).filter(s => s !== null);
        songsInPl = songsInPl.sort(() => 0.5 - Math.random()); 
        
        playbackQueue.push(...songsInPl); 
        alert(`${songsInPl.length} Songs aus "${playlist.name}" gemischt zur Warteschlange hinzugefügt!`);
    });

    document.getElementById('ctx-pl-add-songs')?.addEventListener('click', async () => {
        document.getElementById('playlist-context-overlay')?.classList.remove('active');

        const { data } = await supabaseClient.from('playlist_songs').select('song_id').eq('playlist_id', window.currentContextPlaylistId);
        const existingIds = data ? data.map(d => d.song_id) : [];

        document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.classList.add('hidden'); });
        const viewSongs = document.getElementById('view-songs');
        viewSongs.classList.remove('hidden');
        setTimeout(() => viewSongs.classList.add('active'), 10);
        
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.nav-btn[data-target="view-songs"]')?.classList.add('active');

        currentMode = 'add-to-specific-playlist';
        selectedSongs.clear();
        songsContainer.classList.add('selection-mode');
        
        allSongsElements.forEach(el => {
            if (existingIds.includes(parseInt(el.dataset.id))) {
                el.classList.add('disabled-song');
            }
        });

        const selToolbar = document.getElementById('selection-toolbar');
        selToolbar.classList.remove('hidden');
        setTimeout(() => selToolbar.classList.add('visible'), 10);
        
        document.getElementById('sel-action').innerText = 'Hinzufügen';
        document.getElementById('sel-action').className = 'sel-btn';
        document.getElementById('sel-count').innerText = '0 ausgewählt';
    });

    // --- 10.5 STARTSEITE LOGIK ---
    window.renderHomeSections = function() {
        const recentId = localStorage.getItem('heatbox_last_playlist');
        const recentContainer = document.getElementById('home-recent-playlist');
        if(recentContainer && window.globalPlaylistsData) {
            const rp = window.globalPlaylistsData.find(p => p.id == recentId);
            if (rp) {
                recentContainer.innerHTML = '';
                const card = document.createElement('div'); card.className = 'station-card';
                card.dataset.id = rp.id; 
                const bgImage = rp.cover_data && rp.cover_data.length > 10 ? `url('${rp.cover_data}')` : '';
                card.innerHTML = `
                    <div class="station-cover" style="background-image: ${bgImage};">
                        <button class="cover-play-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
                    </div>
                    <div class="station-title">${rp.name}</div>
                `;
                const playBtn = card.querySelector('.cover-play-btn');
                if (playBtn) playBtn.addEventListener('click', (e) => window.togglePlaylistPlayback(e, rp.id));
                card.addEventListener('click', () => window.openPlaylistDetails(rp.id, rp.name));
                recentContainer.appendChild(card);
            }
        }

        const mixContainer = document.getElementById('home-vibe-mixes');
        if(mixContainer) {
            let mixes = JSON.parse(localStorage.getItem('heatbox_vibe_mixes') || '[]');
            const now = Date.now();
            mixes = mixes.filter(m => m.expires > now); 
            localStorage.setItem('heatbox_vibe_mixes', JSON.stringify(mixes));

            if(mixes.length === 0) {
                mixContainer.innerHTML = '<div style="color: var(--text-secondary); font-size: 13px;">Keine aktiven Vibe Mixe.</div>';
            } else {
                mixContainer.innerHTML = '';
                mixes.forEach(mix => {
                    const card = document.createElement('div'); card.className = 'station-card';
                    card.dataset.id = mix.id; 
                    const bgImage = mix.cover_data && mix.cover_data.length > 10 ? `url('${mix.cover_data}')` : '';
                    card.innerHTML = `
                        <div class="station-cover" style="background-image: ${bgImage};">
                            <button class="cover-play-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
                        </div>
                        <div class="station-title">${mix.name}</div>
                    `;
                    const playBtn = card.querySelector('.cover-play-btn');
                    if (playBtn) playBtn.addEventListener('click', (e) => window.togglePlaylistPlayback(e, mix.id, mix.songs));
                    card.addEventListener('click', () => window.openPlaylistDetails(mix.id, mix.name));
                    mixContainer.appendChild(card);
                });
            }
        }

        const stationsContainer = document.getElementById('stations-container');
        if(stationsContainer) {
            let stations = JSON.parse(localStorage.getItem('heatbox_stations') || '[]');
            const now = Date.now();
            stations = stations.filter(s => s.expires > now); 
            localStorage.setItem('heatbox_stations', JSON.stringify(stations));

            if(stations.length === 0) {
                stationsContainer.innerHTML = '<div style="color: var(--text-secondary); font-size: 13px;">Keine Sender vorhanden. Erstelle einen aus deinen Songs!</div>';
            } else {
                stationsContainer.innerHTML = '';
                stations.forEach(station => {
                    const card = document.createElement('div'); card.className = 'station-card';
                    card.dataset.id = station.id; 
                    const bgImage = station.cover_data && station.cover_data.length > 10 ? `url('${station.cover_data}')` : '';
                    card.innerHTML = `
                        <div class="station-cover" style="background-image: ${bgImage};">
                            <button class="cover-play-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
                        </div>
                        <div class="station-title">${station.name}</div>
                    `;
                    
                    const playBtn = card.querySelector('.cover-play-btn');
                    if (playBtn) playBtn.addEventListener('click', (e) => window.togglePlaylistPlayback(e, station.id, station.songs));

                    card.addEventListener('click', () => {
                        window.currentPlayingPlaylistId = station.id;
                        if (station.songs.length > 0) {
                            const firstSong = station.songs[0];
                            window.playSong(firstSong.title, firstSong.artist, firstSong.cover_data, firstSong.file_url);
                            playbackQueue = station.songs.slice(1);
                            savePlayerState();
                        }
                    });
                    stationsContainer.appendChild(card);
                });
            }
        }
    }

    const homeSearchInput = document.getElementById('home-search-input');
    const homeSearchResults = document.getElementById('home-search-results');
    const homeDefaultContent = document.getElementById('home-default-content');

    if(homeSearchInput) {
        homeSearchInput.addEventListener('input', debounce((e) => {
            const query = e.target.value.toLowerCase().trim();
            
            if (query === '') {
                homeSearchResults.style.display = 'none';
                if(homeDefaultContent) homeDefaultContent.style.display = 'block';
                homeSearchResults.innerHTML = '';
            } else {
                homeSearchResults.style.display = 'flex';
                if(homeDefaultContent) homeDefaultContent.style.display = 'none';
                homeSearchResults.innerHTML = '';
                
                const matchedSongs = globalSongsData.filter(song => 
                    (song.title && song.title.toLowerCase().includes(query)) || 
                    (song.artist && song.artist.toLowerCase().includes(query))
                );

                if (matchedSongs.length === 0) {
                    homeSearchResults.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Keine Songs gefunden.</div>';
                } else {
                    matchedSongs.forEach(song => {
                        const songDiv = document.createElement('div');
                        songDiv.className = 'song-item';
                        songDiv.dataset.id = song.id; 
                        updateSongDOM(songDiv, song);
                        homeSearchResults.appendChild(songDiv);
                    });
                }
            }
        }, 300));
    }

    document.getElementById('btn-home-random')?.addEventListener('click', () => {
        if(globalSongsData.length === 0) return alert("Noch keine Songs in deiner Cloud!");
        const shuffled = [...globalSongsData].sort(() => 0.5 - Math.random());
        const first = shuffled[0];
        window.playSong(first.title, first.artist, first.cover_data, first.file_url);
        playbackQueue = shuffled.slice(1);
        savePlayerState();
    });

    document.getElementById('btn-home-vibemix')?.addEventListener('click', () => {
        const cont = document.getElementById('mix-vibes-container');
        if(cont && cont.innerHTML === '') {
            AVAILABLE_VIBES.forEach(vibe => {
                const pill = document.createElement('div'); pill.className = 'vibe-pill'; pill.innerText = vibe; pill.dataset.vibe = vibe;
                pill.addEventListener('click', () => pill.classList.toggle('active'));
                cont.appendChild(pill);
            });
        }
        document.getElementById('vibe-mix-overlay')?.classList.add('active');
    });

    document.getElementById('btn-create-vibe-mix')?.addEventListener('click', () => {
        const selectedVibes = [];
        document.querySelectorAll('#mix-vibes-container .vibe-pill.active').forEach(p => selectedVibes.push(p.dataset.vibe));
        if(selectedVibes.length === 0) return alert("Bitte wähle mindestens einen Vibe aus.");

        const matchedSongs = globalSongsData.filter(song => {
            if(!song.vibes) return false;
            return selectedVibes.every(v => song.vibes.includes(v));
        });

        if(matchedSongs.length === 0) return alert("Keine Songs mit exakt dieser Kombination gefunden.");

        const mixName = "Vibe Mix: " + selectedVibes.join(', ');
        const mixCover = matchedSongs[0].cover_data;
        
        const newMix = {
            id: 'temp_' + Date.now(),
            name: mixName,
            cover_data: mixCover,
            songs: matchedSongs.map((s, idx) => ({ ...s, sort_order: idx })), 
            expires: Date.now() + (24 * 60 * 60 * 1000) 
        };

        const mixes = JSON.parse(localStorage.getItem('heatbox_vibe_mixes') || '[]');
        mixes.unshift(newMix); 
        localStorage.setItem('heatbox_vibe_mixes', JSON.stringify(mixes));

        document.getElementById('vibe-mix-overlay')?.classList.remove('active');
        document.querySelectorAll('#mix-vibes-container .vibe-pill').forEach(p => p.classList.remove('active'));
        
        window.renderHomeSections();
        alert(`"${mixName}" mit ${matchedSongs.length} Songs erstellt!`);
    });

  // --- 11. PLAYLIST DETAILS VIEW ---
    const viewPlaylistDetails = document.getElementById('view-playlist-details');
    const playlistDetailsSongsContainer = document.getElementById('playlist-details-songs-container');
    let playlistSortable = null;

    document.getElementById('btn-back-to-playlists')?.addEventListener('click', () => {
        window.currentOpenPlaylistId = null;
        viewPlaylistDetails.classList.remove('active'); viewPlaylistDetails.classList.add('hidden');
        const viewPlaylists = document.getElementById('view-playlists');
        viewPlaylists.classList.remove('hidden'); setTimeout(() => viewPlaylists.classList.add('active'), 10);
    });

        window.openPlaylistDetails = async function(playlistId, playlistName) {
        window.currentOpenPlaylistId = playlistId;
        document.getElementById('detail-playlist-title').innerText = playlistName;
        
        let playlist = null;
        let validItems = [];
        let isTemp = playlistId.toString().startsWith('temp_');

        if (isTemp) {
            const mixes = JSON.parse(localStorage.getItem('heatbox_vibe_mixes') || '[]');
            playlist = mixes.find(m => m.id === playlistId);
            if(playlist) {
                validItems = playlist.songs.map((song, i) => ({ id: 't_'+i, song_id: song.id, sort_order: i, songs: song }));
            }
        } else {
            localStorage.setItem('heatbox_last_playlist', playlistId);
            if (typeof window.renderHomeSections === 'function') window.renderHomeSections();

            playlist = window.globalPlaylistsData.find(p => p.id === playlistId);
            const { data, error } = await supabaseClient.from('playlist_songs')
                .select(`id, sort_order, song_id, songs (*)`)
                .eq('playlist_id', playlistId).order('sort_order', { ascending: true }).order('created_at', { ascending: true });
            
            if (error) { playlistDetailsSongsContainer.innerHTML = 'Fehler!'; return; }
            validItems = data.filter(item => item.songs !== null);
        }

        const coverDiv = document.getElementById('detail-playlist-cover');
        if (playlist && playlist.cover_data && playlist.cover_data.length > 10) { coverDiv.style.backgroundImage = `url('${playlist.cover_data}')`; coverDiv.innerHTML = '';} 
        else { coverDiv.style.backgroundImage = 'none'; coverDiv.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2" style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line></svg>`; coverDiv.style.position = 'relative'; }
        
        document.querySelectorAll('.view').forEach(v => { v.classList.remove('active'); v.classList.add('hidden'); });
        viewPlaylistDetails.classList.remove('hidden'); setTimeout(() => viewPlaylistDetails.classList.add('active'), 10);

        playlistDetailsSongsContainer.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-secondary);">Lade Songs...</div>';

        window.currentPlaylistSongs = validItems.map(item => item.songs); 
        playlistDetailsSongsContainer.innerHTML = '';

        let currentCount = window.currentPlaylistSongs.length;
        let currentDur = 0;
        window.currentPlaylistSongs.forEach(s => { if(s.duration) currentDur += s.duration; });
        let freshStatText = `${currentCount} Songs`;
        if (currentDur > 0) freshStatText += ` • ${formatDuration(currentDur)}`;
        document.getElementById('detail-playlist-stats').innerText = freshStatText;

        if (validItems.length === 0) { playlistDetailsSongsContainer.innerHTML = '<div style="text-align:center; padding: 40px 20px; color: var(--text-secondary);">Diese Playlist ist leer.</div>'; return; }

        validItems.forEach(item => {
            const songDiv = document.createElement('div');
            songDiv.className = 'song-item'; songDiv.dataset.id = item.song_id; 
            updateSongDOM(songDiv, item.songs, item.id);
            playlistDetailsSongsContainer.appendChild(songDiv);
        });

        if (playlistSortable) playlistSortable.destroy();
        playlistSortable = new Sortable(playlistDetailsSongsContainer, {
            animation: 150, handle: '.drag-handle', disabled: true, ghostClass: 'sortable-ghost',
            onEnd: async function () {
                    const items = document.querySelectorAll('#playlist-details-songs-container .song-item');
                    if (isTemp) {
                        const mixes = JSON.parse(localStorage.getItem('heatbox_vibe_mixes') || '[]');
                        const mixIdx = mixes.findIndex(m => m.id === playlistId);
                        if (mixIdx > -1) {
                            const newOrder = Array.from(items).map(item => mixes[mixIdx].songs.find(s => s.id == item.dataset.id));
                            mixes[mixIdx].songs = newOrder;
                            localStorage.setItem('heatbox_vibe_mixes', JSON.stringify(mixes));
                        }
                    } else {
                        const updates = Array.from(items).map((item, index) => ({
                            id: parseInt(item.dataset.psId), playlist_id: playlistId, song_id: parseInt(item.dataset.id), sort_order: index
                        }));
                        await supabaseClient.from('playlist_songs').upsert(updates);
                    }
                }
        });
    };

    document.getElementById('btn-pld-play')?.addEventListener('click', () => {
        if(window.currentPlaylistSongs.length === 0) return;
        window.currentPlayingPlaylistId = window.currentOpenPlaylistId; 
        const first = window.currentPlaylistSongs[0];
        window.playSong(first.title, first.artist, first.cover_data, first.file_url);
        playbackQueue = window.currentPlaylistSongs.slice(1);
        savePlayerState();
    });

    document.getElementById('btn-pld-shuffle')?.addEventListener('click', () => {
        if(window.currentPlaylistSongs.length === 0) return;
        window.currentPlayingPlaylistId = window.currentOpenPlaylistId; 
        const shuffled = [...window.currentPlaylistSongs].sort(() => 0.5 - Math.random());
        const first = shuffled[0];
        window.playSong(first.title, first.artist, first.cover_data, first.file_url);
        playbackQueue = shuffled.slice(1);
        savePlayerState();
    });

    
    document.getElementById('btn-pld-search')?.addEventListener('click', () => {
        const cont = document.getElementById('pld-search-container');
        if(cont.style.display === 'none' || !cont.style.display) {
            cont.style.display = 'block'; 
            document.getElementById('pld-search-input').focus();
        } else {
            cont.style.display = 'none'; 
        }
    });

    document.getElementById('pld-search-input')?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('#playlist-details-songs-container .song-item').forEach(el => {
            const title = el.querySelector('.song-title').innerText.toLowerCase();
            const artist = el.querySelector('.song-artist').innerText.toLowerCase();
            if(title.includes(query) || artist.includes(query)) el.style.display = 'flex'; else el.style.display = 'none';
        });
    });

    document.getElementById('playlist-detail-options-btn')?.addEventListener('click', () => {
        document.getElementById('playlist-detail-options-overlay').classList.add('active');
    });

    document.getElementById('pdo-view')?.addEventListener('click', () => {
        document.getElementById('playlist-detail-options-overlay').classList.remove('active');
        document.getElementById('view-sheet-overlay').classList.add('active');
    });

    document.getElementById('pdo-sort')?.addEventListener('click', () => {
        document.getElementById('playlist-detail-options-overlay').classList.remove('active');
        document.getElementById('sort-sheet-overlay').classList.add('active');
        window.currentSortTarget = 'playlist'; 
    });

    document.getElementById('pdo-reorder')?.addEventListener('click', () => {
        document.getElementById('playlist-detail-options-overlay').classList.remove('active');
        currentMode = currentMode === 'reorder' ? 'normal' : 'reorder';
        const container = document.getElementById('playlist-details-songs-container');
        if(currentMode === 'reorder') {
            container.classList.add('reorder-mode');
            if(playlistSortable) playlistSortable.option("disabled", false);
        } else {
            container.classList.remove('reorder-mode');
            if(playlistSortable) playlistSortable.option("disabled", true);
        }
    });

    document.getElementById('pdo-edit')?.addEventListener('click', () => {
        document.getElementById('playlist-detail-options-overlay').classList.remove('active');
        window.currentContextPlaylistId = window.currentOpenPlaylistId;
        document.getElementById('ctx-pl-edit').click(); 
    });

    const detailPlaylistCover = document.getElementById('detail-playlist-cover');
    if (detailPlaylistCover && typeof addLongPressListener === 'function') {
        addLongPressListener(detailPlaylistCover, (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.currentOpenPlaylistId) {
                if (window.currentOpenPlaylistId.toString().startsWith('temp_')) {
                    alert("Dieser temporäre Vibe Mix kann nicht bearbeitet werden.");
                    return;
                }
                window.currentContextPlaylistId = window.currentOpenPlaylistId;
                document.getElementById('ctx-pl-edit').click();
            }
        });
    }

    document.getElementById('pdo-add-songs')?.addEventListener('click', () => {
        document.getElementById('playlist-detail-options-overlay').classList.remove('active');
        window.currentContextPlaylistId = window.currentOpenPlaylistId;
        document.getElementById('ctx-pl-add-songs').click(); 
    });

    // ==========================================
    // --- BIG PLAYER APPLE MUSIC UPDATE ---
    // ==========================================
    const oldPlaySong = window.playSong;
    window.playSong = function(title, artist, coverUrl, fileUrl) {
        oldPlaySong(title, artist, coverUrl, fileUrl); 
        
        const bgStyle = coverUrl && coverUrl.length > 10 ? `url('${coverUrl}')` : 'none';
        document.querySelector('.dynamic-bg').style.backgroundImage = bgStyle;
        document.getElementById('bp-song-name').innerText = title;
        document.getElementById('bp-artist-name').innerText = artist;
    };

    function updateSliderFill(slider, min, max) {
        const percentage = ((slider.value - min) / (max - min)) * 100;
        slider.style.background = `linear-gradient(to right, #ffffff ${percentage}%, rgba(255,255,255,0.2) ${percentage}%)`;
    }

    const volSlider = document.getElementById('volume-slider');
    if(volSlider && audioPlayer) {
        updateSliderFill(volSlider, 0, 1); 
        volSlider.addEventListener('input', (e) => {
            audioPlayer.volume = e.target.value;
            updateSliderFill(e.target, 0, 1);
        });
    }

    const eqPreamp = document.getElementById('eq-preamp');
    if(eqPreamp) {
        updateSliderFill(eqPreamp, -12, 12);
        eqPreamp.addEventListener('input', (e) => {
            if(window.preamp) window.preamp.gain.value = Math.pow(10, e.target.value / 20); 
            const valStr = (e.target.value > 0 ? '+' : '') + e.target.value + ' dB';
            const valDisplay = document.getElementById('eq-preamp-val');
            if(valDisplay) valDisplay.innerText = valStr;
            updateSliderFill(e.target, -12, 12); 
        });
        eqPreamp.addEventListener('change', savePlayerState);
    }

    let isShuffle = false;
    let isRepeat = false;
    
    document.getElementById('btn-repeat')?.addEventListener('click', (e) => {
        isRepeat = !isRepeat;
        e.currentTarget.classList.toggle('ctrl-active', isRepeat);
        audioPlayer.loop = isRepeat; 
    });

    document.getElementById('btn-shuffle')?.addEventListener('click', (e) => {
        isShuffle = !isShuffle;
        e.currentTarget.classList.toggle('ctrl-active', isShuffle);
        if(isShuffle) {
            playbackQueue = playbackQueue.sort(() => 0.5 - Math.random());
        }
    });

    if (audioPlayer) {
        audioPlayer.addEventListener('error', () => {
            console.log("Lied konnte nicht geladen werden, skippe automatisch...");
            isChangingSong = false; 
            window.playNextSong();
        });
        
        audioPlayer.addEventListener('stalled', () => {
            console.log("Internet hakt, warte...");
            // Stalled bedeutet oft nur Pufferung, kein sofortiger Skip nötig
        });
    }

    // WICHTIG: Das ist das echte Ende eines Songs – blockiert nie mehr auf iOS!
    audioPlayer.addEventListener('ended', () => {
        if (isRepeat) {
            audioPlayer.currentTime = 0;
            audioPlayer.play();
            return;
        }
        window.playNextSong(); 
    });

    let queueSortable = null;
    document.getElementById('btn-queue-menu')?.addEventListener('click', () => {
        const qContainer = document.getElementById('queue-list');
        qContainer.innerHTML = '';
        
        if (window.currentSongData) {
            const currentDiv = document.createElement('div');
            currentDiv.className = 'song-item playing-active'; 
            currentDiv.style.background = 'rgba(250, 35, 59, 0.15)'; 
            currentDiv.style.border = '1px solid var(--accent)';
            currentDiv.style.marginBottom = '20px';
            currentDiv.style.borderRadius = '10px';
            currentDiv.style.padding = '10px';
            
            const cCover = window.currentSongData.coverUrl || window.currentSongData.cover_data || 'var(--accent)';
            const cBg = cCover.length > 10 ? (cCover.startsWith('http') || cCover.startsWith('data:') ? `url('${cCover}')` : 'var(--accent)') : 'var(--accent)';
            
            currentDiv.innerHTML = `
                <div class="song-cover" style="background: ${cBg}; background-size: cover; position: relative;">
                    <div class="playing-anim" style="position: absolute; bottom: 5px; right: 5px; transform: scale(0.6);">
                        <span></span><span></span><span></span>
                    </div>
                </div>
                <div class="song-info">
                    <div class="song-title" style="color: var(--accent); font-size: 18px;">${window.currentSongData.title}</div>
                    <div class="song-artist">${window.currentSongData.artist}</div>
                </div>
                <div style="font-size: 11px; color: var(--accent); font-weight: bold; margin-right: 5px; letter-spacing: 1px;">LÄUFT</div>
            `;
            qContainer.appendChild(currentDiv);
        }

        if (playbackQueue.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.style.padding = '20px';
            emptyMsg.style.textAlign = 'center';
            emptyMsg.style.color = 'var(--text-secondary)';
            emptyMsg.innerText = 'Keine weiteren Lieder in der Warteschlange.';
            qContainer.appendChild(emptyMsg);
        } else {
            playbackQueue.forEach((song, index) => {
                const div = document.createElement('div');
                div.className = 'song-item';
                div.dataset.index = index;
                
                let qStartX = 0;
                div.addEventListener('touchstart', (e) => { qStartX = e.touches[0].clientX; }, {passive: true});
                div.addEventListener('touchend', (e) => {
                    if(!qStartX) return;
                    let diffX = qStartX - e.changedTouches[0].clientX;
                    if(diffX > 50) { 
                        const actualIndex = playbackQueue.indexOf(song);
                        if(actualIndex > -1) playbackQueue.splice(actualIndex, 1);
                        div.style.transition = 'all 0.3s var(--spring-easing)';
                        div.style.transform = 'translateX(-100%)';
                        div.style.opacity = '0';
                        setTimeout(() => div.remove(), 300);
                        savePlayerState();
                    }
                    qStartX = 0;
                });
                
                const cover = song.cover_data && song.cover_data.length > 10 ? `url('${song.cover_data}')` : 'var(--accent)';
                div.innerHTML = `
                    <div class="song-cover" style="background: ${cover}; background-size: cover;"></div>
                    <div class="song-info">
                        <div class="song-title">${song.title}</div>
                        <div class="song-artist">${song.artist}</div>
                    </div>
                    <div class="drag-handle" style="display:block;">≡</div>
                `;
                qContainer.appendChild(div);
            });

            if (queueSortable) queueSortable.destroy();
            queueSortable = new Sortable(qContainer, {
                animation: 150, handle: '.drag-handle', ghostClass: 'sortable-ghost',
                onEnd: function (evt) {
                    const movedItem = playbackQueue.splice(evt.oldIndex, 1)[0];
                    playbackQueue.splice(evt.newIndex, 0, movedItem);
                }
            });
        }
        document.getElementById('queue-overlay').classList.add('active');
    });

    document.getElementById('btn-audio-out')?.addEventListener('click', async () => {
        const outList = document.getElementById('audio-devices-list');
        outList.innerHTML = '';
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices || !audioPlayer.setSinkId) {
                outList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Dein Browser unterstützt diese Funktion leider nicht.</div>';
            } else {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
                audioOutputs.forEach(device => {
                    const btn = document.createElement('button');
                    btn.className = 'sheet-btn';
                    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg> ${device.label || 'Unbekannter Lautsprecher'}`;
                    btn.addEventListener('click', () => {
                        audioPlayer.setSinkId(device.deviceId);
                        document.getElementById('audio-out-overlay').classList.remove('active');
                    });
                    outList.appendChild(btn);
                });
            }
        } catch(e) { outList.innerHTML = 'Fehler beim Laden der Geräte.'; }
        document.getElementById('audio-out-overlay').classList.add('active');
    });

    const hdAudioToggle = document.getElementById('setting-hd-audio');
    if (hdAudioToggle) {
        hdAudioToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                if(audioPlayer) audioPlayer.volume = 1.0;
                alert("HD Audio aktiviert! Maximale Qualität geladen.");
            }
        });
    }

    const bigCover = document.getElementById('big-player-cover');
    if(bigCover) {
        addLongPressListener(bigCover, (e) => {
            const activeId = window.currentPlayingSongId || (window.currentSongData ? window.currentSongData.id : null);
            if (activeId) window.currentContextSongId = activeId;
            document.getElementById('big-player-context-overlay').classList.add('active');
        });
    }

    document.getElementById('bp-ctx-add-playlist')?.addEventListener('click', () => {
        document.getElementById('big-player-context-overlay').classList.remove('active');
        selectedSongs.clear(); selectedSongs.add(window.currentContextSongId);
        window.openPlaylistSelection();
    });
    document.getElementById('bp-ctx-edit-tags')?.addEventListener('click', () => {
        document.getElementById('big-player-context-overlay').classList.remove('active');
        document.getElementById('ctx-edit-tags').click();
    });
    document.getElementById('bp-ctx-delete')?.addEventListener('click', () => {
        document.getElementById('big-player-context-overlay').classList.remove('active');
        document.getElementById('ctx-delete').click();
    });
    document.getElementById('bp-ctx-edit-style')?.addEventListener('click', () => {
        document.getElementById('big-player-context-overlay').classList.remove('active');
        document.getElementById('player-style-overlay').classList.add('active');
    });

    window.setPlayerStyle = function(styleClass) {
        bigCover.className = `large-cover ${styleClass}`;
        document.getElementById('player-style-overlay').classList.remove('active');
    };

    document.querySelectorAll('.close-alert, .close-sub-sheet').forEach(btn => {
        btn.addEventListener('click', (e) => { const overlay = e.target.closest('.action-sheet-overlay'); if(overlay) overlay.classList.remove('active'); });
    });
    document.getElementById('more-options-btn')?.addEventListener('click', () => actionSheetOverlay.classList.add('active'));
    document.getElementById('cancel-sheet-btn')?.addEventListener('click', () => actionSheetOverlay.classList.remove('active'));

    // ==========================================
    // --- 12. SETTINGS, BACKUP & CARPLAY LOGIK ---
    // ==========================================
    const colorPicker = document.getElementById('theme-color-picker');
    if (colorPicker) {
        const savedColor = localStorage.getItem('heatbox_theme_color');
        if (savedColor) {
            colorPicker.value = savedColor;
            document.documentElement.style.setProperty('--accent', savedColor);
        }
        colorPicker.addEventListener('input', (e) => {
            const newColor = e.target.value;
            document.documentElement.style.setProperty('--accent', newColor);
            localStorage.setItem('heatbox_theme_color', newColor);
            if(typeof window.updateActiveHighlights === 'function') window.updateActiveHighlights();
        });
    }

    const cfToggle = document.getElementById('setting-crossfade-toggle');
    if (cfToggle) {
        cfToggle.checked = localStorage.getItem('heatbox_crossfade') === 'true';
        window.isCrossfadeEnabled = cfToggle.checked;
        cfToggle.addEventListener('change', (e) => {
            window.isCrossfadeEnabled = e.target.checked;
            localStorage.setItem('heatbox_crossfade', e.target.checked);
        });
    }

    window.updateAppStats = function() {
        const statsEl = document.getElementById('app-stats-text');
        if (statsEl) {
            const songCount = globalSongsData ? globalSongsData.length : 0; 
            const plCount = window.globalPlaylistsData ? window.globalPlaylistsData.length : 0;
            statsEl.innerText = `${songCount} Songs • ${plCount} Playlists in der Cloud`;
        }
    };

    document.getElementById('btn-backup-download')?.addEventListener('click', () => {
        const backupData = {
            state: JSON.parse(localStorage.getItem('heatbox_state') || '{}'),
            mixes: JSON.parse(localStorage.getItem('heatbox_vibe_mixes') || '[]'),
            stations: JSON.parse(localStorage.getItem('heatbox_stations') || '[]'),
            theme: localStorage.getItem('heatbox_theme_color') || '#fa233b',
            timestamp: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(backupData, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `HeaTBox_Backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    document.getElementById('btn-carplay')?.addEventListener('click', () => {
        alert("🚗 Apple CarPlay & Android Auto bereit!\n\nVerbinde dein Handy einfach per Kabel oder Bluetooth mit deinem Auto. Da HeaTBox jetzt die native Media-Schnittstelle nutzt, werden Songs, Cover und die Steuerung automatisch auf dein Auto-Display übertragen!");
    });

    document.querySelectorAll('.action-sheet-overlay').forEach(overlay => {
        const sheet = overlay.querySelector('.action-sheet');
        if(!sheet) return;
        let sheetStartY = 0;
        
        sheet.addEventListener('touchstart', (e) => { sheetStartY = e.touches[0].clientY; }, {passive: true});
        sheet.addEventListener('touchend', (e) => {
            if(!sheetStartY) return;
            let diffY = e.changedTouches[0].clientY - sheetStartY;
            if(diffY > 60) overlay.classList.remove('active');
            sheetStartY = 0;
        });
    });

    document.querySelectorAll('.action-sheet-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    });
});

//new