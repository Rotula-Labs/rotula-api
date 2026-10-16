import http from 'http';
import https from 'https';

export const KEEP_ALIVE_SOCKETS: number = Number(process.env.HTTP_KeepAlive_Sockets ?? 25);
export const KEEP_ALIVE_IDLE_TIMEOUT: number = Number(process.env.HTTP_KeepAlive_IdleTimeout ?? 10000);

export const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: KEEP_ALIVE_SOCKETS,
  maxFreeSockets: KEEP_ALIVE_SOCKETS,
  keepAliveMsecs: KEEP_ALIVE_IDLE_TIMEOUT,
});

export const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: KEEP_ALIVE_SOCKETS,
  maxFreeSockets: KEEP_ALIVE_SOCKETS,
  keepAliveMsecs: KEEP_ALIVE_IDLE_TIMEOUT,
});

export const keepAliveAgents = {
  http: httpAgent,
  https: httpsAgent,
};
