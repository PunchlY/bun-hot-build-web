import options from './client-serve';

Bun.serve({
    static: {
        ...options.static,
    },
    fetch: options.fetch,
});
