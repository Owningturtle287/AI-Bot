import { pauseQueue, wakeQueue } from './queue-runner.mjs';

self.onmessage = ({ data }) => {
  if (data === 'queue:pause') pauseQueue();
  if (data === 'queue:wake') void wakeQueue(message => self.postMessage(message));
};
