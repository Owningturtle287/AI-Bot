import { pauseQueue, wakeQueue } from './queue-runner.mjs?v=5';

self.onmessage = ({ data }) => {
  if (data === 'queue:pause') pauseQueue();
  if (data === 'queue:wake') void wakeQueue(message => self.postMessage(message));
};
