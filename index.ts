import { dev, staticData } from './build';

Bun.serve({
    static: Object.fromEntries(staticData()),
    async fetch(request, server) {
        if (process.env.NODE_ENV !== 'production') {
            const { url } = request;
            const pathIndex = url.indexOf('/', 8);
            const queryIndex = url.indexOf('?', pathIndex);
            const path = queryIndex === -1 ? url.substring(pathIndex) : url.substring(pathIndex, queryIndex);
            return await dev(path, server) || new Response('Not Found', { status: 404 });
        }
        return new Response('Not Found', { status: 404 });
    }
});
