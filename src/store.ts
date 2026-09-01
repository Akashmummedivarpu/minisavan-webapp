import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { socket } from './socket';
import { logger } from './core/logger';

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

export type PlaybackMode = 'PERSONAL' | 'ROOM';

interface RoomState {
  // Auth State
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  logout: () => void;

  // Mode
  mode: PlaybackMode;

  // Room & Playback State
  roomId: string | null;
  roomRole: string | null; // 'ADMIN' | 'CONTROLLER' | 'MEMBER'
  isPlaying: boolean;
  currentTime: number;
  currentSong: any | null;
  listeners: number;
  messages: ChatMessage[];
  stateTimestamp: number; // server timestamp when state was set
  serverTime: number; // server's Date.now() at join time
  lastSequenceNumber: number;
  roomMembers: any[];
  roomQueue: any[];

  // Personal queue saved when entering room
  savedQueue: any[];
  savedIndex: number;

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
  clearQueue: () => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
}

// Socket listener registration lives outside the store creator so it
// can be cleanly set up once and torn down on leave.
let listenersRegistered = false;

function registerSocketListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  socket.on('room:state', (data) => {
    if (data.playbackState) {
      const nextSeq = data.playbackState.sequenceNumber ?? 0;
      const currentSeq = useRoomStore.getState().lastSequenceNumber;
      // Reject stale updates
      if (nextSeq < currentSeq) return;
      useRoomStore.setState({
        isPlaying: data.playbackState.status === 'PLAYING',
        currentTime: data.playbackState.positionMs / 1000,
        currentSong: data.playbackState.currentSong,
        stateTimestamp: data.playbackState.stateTimestamp || Date.now(),
        serverTime: data.serverTime || Date.now(),
        listeners: data.listenerCount ?? useRoomStore.getState().listeners,
        roomRole: data.role ?? useRoomStore.getState().roomRole,
        lastSequenceNumber: nextSeq,
        roomMembers: data.members || [],
        roomQueue: data.queue || [],
      });
    }
  });

  socket.on('room:playback-updated', (data) => {
    const nextSeq = data.sequenceNumber ?? 0;
    const currentSeq = useRoomStore.getState().lastSequenceNumber;
    if (nextSeq < currentSeq) return;
    useRoomStore.setState({
      isPlaying: data.status === 'PLAYING',
      currentTime: data.positionMs / 1000,
      currentSong: data.currentSong,
      stateTimestamp: data.stateTimestamp || Date.now(),
      lastSequenceNumber: nextSeq,
    });
  });

  socket.on('room:track-changed', (data) => {
    const nextSeq = data.sequenceNumber ?? 0;
    const currentSeq = useRoomStore.getState().lastSequenceNumber;
    if (nextSeq < currentSeq) return;
    useRoomStore.setState({
      isPlaying: data.status === 'PLAYING',
      currentTime: data.positionMs / 1000,
      currentSong: data.currentSong,
      stateTimestamp: data.stateTimestamp || Date.now(),
      lastSequenceNumber: nextSeq,
    });
  });

  socket.on('room:member-joined', (data) => {
    if (data.listenerCount !== undefined) {
      useRoomStore.setState({ listeners: data.listenerCount });
    } else {
      useRoomStore.setState((state) => ({ listeners: state.listeners + 1 }));
    }
  });

  socket.on('room:member-left', (data) => {
    if (data.listenerCount !== undefined) {
      useRoomStore.setState({ listeners: data.listenerCount });
    } else {
      useRoomStore.setState((state) => ({ listeners: Math.max(0, state.listeners - 1) }));
    }
  });

  socket.on('room:chat-message', (message: ChatMessage) => {
    useRoomStore.setState((state) => ({
      messages: [...state.messages, message]
    }));
  });

  socket.on('room:admin-transferred', (data) => {
    const current = useRoomStore.getState();
    if (current.roomRole === 'ADMIN' && data.newAdminId && data.newAdminId !== current.user?.id) {
      useRoomStore.setState({ roomRole: 'MEMBER' });
    }
    logger.info('Room admin transferred', data.message);
  });

  socket.on('room:ended', (data) => {
    logger.info('Room ended', data.message);
    useRoomStore.setState({ roomId: null, roomRole: null, isPlaying: false, currentSong: null, messages: [], mode: 'PERSONAL' });
  });

  socket.on('room:queue-cleared', (data) => {
    logger.info('Room queue cleared', data.message);
    useRoomStore.setState({
      isPlaying: false,
      currentTime: 0,
      currentSong: null,
      roomQueue: [],
      stateTimestamp: data.state?.stateTimestamp || Date.now(),
    });
  });
}

export const useRoomStore = create<RoomState>()(
  persist(
    (set, get) => {
      registerSocketListeners();

      return {
        // Auth
        user: null,
        token: null,
        setAuth: (user, token) => set({ user, token }),
        logout: () => set({ user: null, token: null }),

        // Mode
        mode: 'PERSONAL',

        // Room
        roomId: null,
        roomRole: null,
        isPlaying: false,
        currentTime: 0,
        currentSong: null,
        listeners: 1,
        messages: [],
        stateTimestamp: 0,
        serverTime: 0,
        lastSequenceNumber: -1,
        roomMembers: [],
        roomQueue: [],

        // Saved personal state
        savedQueue: [],
        savedIndex: 0,

        queue: [],
        currentIndex: -1,

        joinRoom: (roomId) => {
          const { user, mode, queue, currentIndex } = get();
          if (!user) return;

          // Save personal playback state before switching to ROOM mode
          if (mode === 'PERSONAL') {
            useRoomStore.setState({
              savedQueue: queue,
              savedIndex: currentIndex,
              mode: 'ROOM',
              messages: [],
              roomQueue: [],
              roomMembers: [],
              lastSequenceNumber: -1,
              isPlaying: false,
              currentTime: 0,
              currentSong: null,
            });
          }

          if (!socket.connected) socket.connect();
          socket.emit('room:join', { roomId, userId: user.id }, (res: any) => {
            if (res.success) {
              set({ roomId });
            } else {
              logger.error("Failed to join room", res.error);
              // Restore personal mode on failure
              useRoomStore.setState({ mode: 'PERSONAL', roomId: null });
            }
          });
        },

        leaveRoom: () => {
          const { roomId, savedQueue, savedIndex } = get();
          if (roomId) socket.emit('room:leave', { roomId });
          // Do NOT disconnect the socket — keep it alive for rejoining
          set({
            roomId: null,
            roomRole: null,
            isPlaying: false,
            currentSong: null,
            messages: [],
            roomMembers: [],
            roomQueue: [],
            mode: 'PERSONAL',
            lastSequenceNumber: -1,
            // Restore personal queue
            queue: savedQueue,
            currentIndex: savedIndex,
          });
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
            socket.emit('room:chat', { roomId, message });
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
        },

        clearQueue: () => {
          set({ queue: [], currentIndex: -1 });
        },

        removeFromQueue: (index) => {
          const { queue, currentIndex } = get();
          if (index < 0 || index >= queue.length) return;
          const newQueue = queue.filter((_, i) => i !== index);
          let newIndex = currentIndex;
          if (index < currentIndex) {
            newIndex = currentIndex - 1;
          }
          set({ queue: newQueue, currentIndex: Math.min(newIndex, newQueue.length - 1) });
        },

        reorderQueue: (fromIndex, toIndex) => {
          const { queue } = get();
          if (fromIndex < 0 || fromIndex >= queue.length || toIndex < 0 || toIndex >= queue.length) return;
          const newQueue = [...queue];
          const [moved] = newQueue.splice(fromIndex, 1);
          newQueue.splice(toIndex, 0, moved);
          set({ queue: newQueue });
        },
      };
    },
    {
      name: 'sonicroom-storage',
      // Only persist auth state
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);
