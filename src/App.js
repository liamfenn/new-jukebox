import { useState, useEffect } from 'react';
import SpotifyWebApi from 'spotify-web-api-js';
import { PlayIcon, PauseIcon, ForwardIcon, BackwardIcon } from '@heroicons/react/24/solid';

const spotify = new SpotifyWebApi();

const CLIENT_ID = '1ccf16dbea164b57b82c7502cc3cbb9a';
const REDIRECT_URIS = {
  development: 'http://localhost:3000',
  production: 'https://new-jukebox.vercel.app'
};

const REDIRECT_URI = process.env.NODE_ENV === 'production' 
  ? REDIRECT_URIS.production 
  : REDIRECT_URIS.development;

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'streaming',
  'user-read-email',
  'user-read-private'
];

function App() {
  const [token, setToken] = useState(null);
  const [player, setPlayer] = useState(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [tracks, setTracks] = useState([]);

  useEffect(() => {
    const hash = window.location.hash
      .substring(1)
      .split('&')
      .reduce((initial, item) => {
        let parts = item.split('=');
        initial[parts[0]] = decodeURIComponent(parts[1]);
        return initial;
      }, {});

    window.location.hash = '';
    let _token = hash.access_token || localStorage.getItem('spotify_token');

    if (_token) {
      localStorage.setItem('spotify_token', _token);
      setToken(_token);
      spotify.setAccessToken(_token);
      initializePlayer(_token);
      fetchTracks(_token);
    }
  }, []);

  const fetchTracks = async (token) => {
    try {
      setIsLoading(true);
      setError(null);

      // First, get some indie playlists
      const indiePlaylists = await spotify.searchPlaylists('indie rock essentials', { limit: 5 });
      
      if (!indiePlaylists?.playlists?.items?.length) {
        throw new Error('No playlists found');
      }

      // Get valid playlists and their tracks
      const validPlaylists = indiePlaylists.playlists.items.filter(playlist => playlist && playlist.id);
      
      if (validPlaylists.length === 0) {
        throw new Error('No valid playlists found');
      }

      // Get tracks from these playlists
      const playlistTracks = await Promise.all(
        validPlaylists.slice(0, 3).map(async playlist => {
          try {
            return await spotify.getPlaylistTracks(playlist.id, { limit: 10 });
          } catch (error) {
            console.error(`Error fetching tracks for playlist ${playlist.id}:`, error);
            return { items: [] };
          }
        })
      );

      // Flatten and filter the tracks
      const allTracks = playlistTracks
        .flatMap(result => result.items || [])
        .filter(item => (
          item && 
          item.track && 
          item.track.uri &&
          item.track.name &&
          item.track.artists?.length > 0 &&
          item.track.album?.images?.length > 0
        ))
        .map(item => ({
          uri: item.track.uri,
          name: item.track.name,
          artist: item.track.artists[0].name,
          album: item.track.album,
          id: item.track.id
        }));

      if (allTracks.length === 0) {
        throw new Error('No valid tracks found');
      }

      // Shuffle the tracks
      const shuffledTracks = allTracks.sort(() => Math.random() - 0.5).slice(0, 20);
      setTracks(shuffledTracks);

      // Set initial track
      if (shuffledTracks.length > 0) {
        const trackInfo = await spotify.getTrack(shuffledTracks[0].id);
        setCurrentTrack(trackInfo);
      }
    } catch (error) {
      console.error('Error fetching tracks:', error);
      setError(`Failed to load tracks: ${error.message}`);
      
      // Fallback to a known working playlist if the search fails
      try {
        const fallbackPlaylist = await spotify.getPlaylist('37i9dQZF1DX2sUQwD7tbmL');
        const fallbackTracks = fallbackPlaylist.tracks.items
          .filter(item => (
            item && 
            item.track && 
            item.track.uri &&
            item.track.name &&
            item.track.artists?.length > 0 &&
            item.track.album?.images?.length > 0
          ))
          .map(item => ({
            uri: item.track.uri,
            name: item.track.name,
            artist: item.track.artists[0].name,
            album: item.track.album,
            id: item.track.id
          }));

        if (fallbackTracks.length > 0) {
          setTracks(fallbackTracks);
          const trackInfo = await spotify.getTrack(fallbackTracks[0].id);
          setCurrentTrack(trackInfo);
          setError(null);
        }
      } catch (fallbackError) {
        console.error('Fallback playlist failed:', fallbackError);
        setError('Could not load any tracks. Please try again later.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const initializePlayer = (token) => {
    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'Indie Rock Jukebox',
        getOAuthToken: cb => { cb(token); }
      });

      player.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        setDeviceId(device_id);
        setPlayer(player);
        if (tracks.length > 0) {
          loadCurrentTrack(device_id);
        }
      });

      player.addListener('not_ready', ({ device_id }) => {
        console.log('Device ID has gone offline', device_id);
      });

      player.addListener('player_state_changed', (state) => {
        if (state) {
          setIsPlaying(!state.paused);
        }
      });

      player.connect();
    };
  };

  const loadCurrentTrack = async (deviceId) => {
    try {
      setIsLoading(true);
      setError(null);
      
      if (!tracks[currentTrackIndex]) {
        throw new Error('No track available');
      }

      const trackInfo = await spotify.getTrack(tracks[currentTrackIndex].id);
      setCurrentTrack(trackInfo);
      
      await spotify.play({
        device_id: deviceId,
        uris: [tracks[currentTrackIndex].uri]
      });
    } catch (error) {
      console.error('Error loading track:', error);
      setError('Failed to load track. Please try again.');
      if (currentTrackIndex < tracks.length - 1) {
        setCurrentTrackIndex(prev => prev + 1);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const nextTrack = async () => {
    if (isLoading || tracks.length === 0) return;
    
    try {
      setIsLoading(true);
      setError(null);
      const nextIndex = (currentTrackIndex + 1) % tracks.length;
      setCurrentTrackIndex(nextIndex);
      
      const trackInfo = await spotify.getTrack(tracks[nextIndex].id);
      setCurrentTrack(trackInfo);
      
      await spotify.play({
        device_id: deviceId,
        uris: [tracks[nextIndex].uri]
      });
    } catch (error) {
      console.error('Error skipping track:', error);
      setError('Failed to skip track. Trying next one...');
      if (currentTrackIndex < tracks.length - 1) {
        setCurrentTrackIndex(prev => (prev + 2) % tracks.length);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const previousTrack = async () => {
    if (isLoading || tracks.length === 0) return;
    
    try {
      setIsLoading(true);
      setError(null);
      const prevIndex = currentTrackIndex === 0 ? tracks.length - 1 : currentTrackIndex - 1;
      setCurrentTrackIndex(prevIndex);
      
      const trackInfo = await spotify.getTrack(tracks[prevIndex].id);
      setCurrentTrack(trackInfo);
      
      await spotify.play({
        device_id: deviceId,
        uris: [tracks[prevIndex].uri]
      });
    } catch (error) {
      console.error('Error going to previous track:', error);
      setError('Failed to go to previous track. Trying again...');
      if (currentTrackIndex > 0) {
        setCurrentTrackIndex(prev => prev - 2 >= 0 ? prev - 2 : tracks.length - 1);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const togglePlayPause = async () => {
    if (!player) return;
    
    try {
      if (isPlaying) {
        await player.pause();
      } else {
        await player.resume();
      }
      setIsPlaying(!isPlaying);
      setError(null);
    } catch (error) {
      console.error('Error toggling playback:', error);
      setError('Failed to control playback.');
    }
  };

  const login = () => {
    window.location.href = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
      REDIRECT_URI
    )}&scope=${encodeURIComponent(SCOPES.join(' '))}&response_type=token&show_dialog=true`;
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <button
          onClick={login}
          className="px-8 py-3 bg-black text-white rounded font-medium hover:bg-gray-900 transition-colors"
        >
          Connect with Spotify
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-full max-w-2xl px-8">
        
        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded mb-8 text-center text-sm">
            {error}
          </div>
        )}
        
        {/* Now Playing */}
        {currentTrack && (
          <div className="bg-white rounded p-8">
            <div className="flex flex-col items-center">
              <div className="relative w-64 h-64 mb-8">
                <img
                  src={currentTrack.album.images[0].url}
                  alt={currentTrack.name}
                  className="w-full h-full object-cover rounded shadow-sm"
                />
                {isLoading && (
                  <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center rounded">
                    <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                  </div>
                )}
              </div>
              <div className="text-center mb-8">
                <h2 className="text-xl font-medium mb-2">{currentTrack.name}</h2>
                <p className="text-gray-500">{currentTrack.artists[0].name}</p>
              </div>
            </div>
            
            <div className="flex justify-center items-center space-x-8">
              <button 
                onClick={previousTrack}
                disabled={isLoading}
                className="p-2 text-gray-400 hover:text-gray-900 transition-colors disabled:opacity-50"
                aria-label="Previous track"
              >
                <BackwardIcon className="w-6 h-6" />
              </button>
              <button 
                onClick={togglePlayPause}
                disabled={isLoading}
                className="p-4 bg-black rounded hover:bg-gray-900 transition-colors text-white disabled:opacity-50"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <PauseIcon className="w-6 h-6" />
                ) : (
                  <PlayIcon className="w-6 h-6" />
                )}
              </button>
              <button 
                onClick={nextTrack}
                disabled={isLoading}
                className="p-2 text-gray-400 hover:text-gray-900 transition-colors disabled:opacity-50"
                aria-label="Next track"
              >
                <ForwardIcon className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
