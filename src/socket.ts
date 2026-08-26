import { io } from 'socket.io-client';

const URL = 'http://localhost:3001';

export const socket = io(URL, {
  autoConnect: false,
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    socket.disconnect();
  });
}
