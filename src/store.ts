import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { socket } from './socket';

interface User {
  id: string;
  username: string;
  phoneNumber: string;
  avatar?: string;
}

interface ChatMessage {
  userId: string;
  username: string;
  message: string;
  createdAt: number;
}

interface RoomState {
  // Auth State
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  logout: () => void;

  // Room & Playback State
  roomId: string | null;
  roomRole: string | null; // 'ADMIN' | 'CONTROLLER' | 'MEMBER'
  isPlaying: boolean;
  currentTime: number;
  currentSong: any | null;
  listeners: number;
  messages: ChatMessage[];
  
  // Queue & Playlist State
  queue: any[];
  currentIndex: number;
  
  joinRoom: (roomId: string) => void;
  leaveRoom: () => void;
  playSong: (song: any) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  sendChatMessage: (message: string) => void;
  
  setQueue: (queue: any[], startIndex?: number) => void;
  addToQueue: (song: any) => void;
  playNext: () => void;
  playPrevious: () => void;
}

export const useRoomStore = create<RoomState>()(
  persist(
    (set, get) => {
      // Listen to socket events
      socket.on('room:state', (data) => {
        if (data.playbackState) {
          set({ 
            isPlaying: data.playbackState.status === 'PLAYING', 
            currentTime: data.playbackState.positionMs / 1000, 
            currentSong: data.playbackState.currentSong,
            // Use real-time count from server if provided
            listeners: data.listenerCount ?? get().listeners,
            // Capture the user's role in this room
            roomRole: data.role ?? get().roomRole
          });
        }
      });

      socket.on('room:playback-updated', (data) => {
        set({ 
          isPlaying: data.status === 'PLAYING', 
          currentTime: data.positionMs / 1000, 
          currentSong: data.currentSong 
        });
      });

      socket.on('room:track-changed', (data) => {
        set({ 
          isPlaying: data.status === 'PLAYING', 
          currentTime: data.positionMs / 1000, 
          currentSong: data.currentSong 
        });
      });

      socket.on('room:member-joined', (data) => {
        if (data.listenerCount !== undefined) {
          set({ listeners: data.listenerCount });
        } else {
          set((state) => ({ listeners: state.listeners + 1 }));
        }
      });

      socket.on('room:member-left', (data) => {
        if (data.listenerCount !== undefined) {
          set({ listeners: data.listenerCount });
        } else {
          set((state) => ({ listeners: Math.max(0, state.listeners - 1) }));
        }
      });

      socket.on('room:chat-message', (message: ChatMessage) => {
        set((state) => ({
          messages: [...state.messages, message]
        }));
      });

      return {
        // Auth
        user: null,
        token: null,
        setAuth: (user, token) => set({ user, token }),
        logout: () => set({ user: null, token: null }),

        // Room
        roomId: null,
        roomRole: null,
        isPlaying: false,
        currentTime: 0,
        currentSong: null,
        listeners: 1,
        messages: [],
        queue: [],
        currentIndex: -1,
        
        joinRoom: (roomId) => {
          const { user } = get();
          if (!user) return;

          socket.connect();
          socket.emit('room:join', { roomId, userId: user.id }, (res: any) => {
            if (res.success) {
              set({ roomId });
            } else {
              console.error("Failed to join room", res.error);
            }
          });
        },
        
        leaveRoom: () => {
          const { roomId } = get();
          if (roomId) socket.emit('room:leave', { roomId });
          socket.disconnect();
          set({ roomId: null, roomRole: null, isPlaying: false, currentSong: null, messages: [] });
        },

        playSong: (song) => {
          const { roomId, roomRole } = get();
          // Only ADMIN/CONTROLLER can change tracks in a room
          if (roomId && roomRole === 'MEMBER') return;
          set({ currentSong: song, isPlaying: true });
          
          if (roomId) {
            socket.emit('room:change-track', { roomId, song });
          }
        },

        togglePlay: () => {
          const { isPlaying, roomId, currentTime, roomRole } = get();
          // Only ADMIN/CONTROLLER can toggle play in a room
          if (roomId && roomRole === 'MEMBER') return;
          const nextState = !isPlaying;
          set({ isPlaying: nextState });

          if (roomId) {
            if (nextState) {
              socket.emit('room:play', { roomId, positionMs: currentTime * 1000 });
            } else {
              socket.emit('room:pause', { roomId, positionMs: currentTime * 1000 });
            }
          }
        },

        seek: (time) => {
          const { roomId, roomRole } = get();
          // Only ADMIN/CONTROLLER can seek in a room
          if (roomId && roomRole === 'MEMBER') return;
          set({ currentTime: time });
          if (roomId) {
            socket.emit('room:seek', { roomId, positionMs: time * 1000 });
          }
        },

        sendChatMessage: (message) => {
          const { roomId, user } = get();
          if (roomId && user && message.trim()) {
            socket.emit('room:chat', { roomId, message, username: user.username });
          }
        },

        setQueue: (queue, startIndex = 0) => {
          set({ queue, currentIndex: startIndex });
          if (queue.length > 0) {
            get().playSong(queue[startIndex]);
          }
        },

        addToQueue: (song) => {
          set((state) => ({ queue: [...state.queue, song] }));
        },

        playNext: () => {
          const { queue, currentIndex, playSong } = get();
          if (currentIndex < queue.length - 1) {
            const nextIndex = currentIndex + 1;
            set({ currentIndex: nextIndex });
            playSong(queue[nextIndex]);
          } else {
            // Stop playing if queue is empty or at end
            const { roomId } = get();
            set({ currentSong: null, isPlaying: false, currentIndex: -1 });
            if (roomId) {
              socket.emit('room:change-track', { roomId, song: null });
            }
          }
        },

        playPrevious: () => {
          const { queue, currentIndex, playSong } = get();
          if (currentIndex > 0) {
            const prevIndex = currentIndex - 1;
            set({ currentIndex: prevIndex });
            playSong(queue[prevIndex]);
          } else if (queue.length > 0) {
            // Replay first song
            set({ currentIndex: 0 });
            playSong(queue[0]);
          }
        }
      };
    },
    {
      name: 'sonicroom-storage',
      // Only persist auth state
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);

if (typeof window !== 'undefined') {
  (window as any).useRoomStore = useRoomStore;
}
