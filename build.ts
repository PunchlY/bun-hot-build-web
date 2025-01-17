import type { Server } from 'bun';
import { resolve, relative, basename, dirname } from 'path';
import { watch, type FSWatcher } from 'fs';
import { staticDataEncode_macro } from './build' with { type: 'macro' };
import { unescapeHTML } from './lib/html';

const entry = 'index.html', assets = 'public';

function build() {
    return new class Build {
        #entry = entry;
        #map?: Map<`/${string}`, { body: Buffer, type: string; }>;
        #watch?: Map<string, FSWatcher>;
        #server?: Server;
        #watchFile(filename: string) {
            this.#watch ??= new Map();
            if (this.#watch.has(filename))
                return;
            console.debug('[watch] %o filename=%s', new Date(), filename);
            this.#watch.set(filename, watch(filename, async (event) => {
                console.debug(`[%s] %o filename=%s`, event, new Date(), filename);
                if (event === 'rename') {
                    this.#watch?.get(filename)?.close();
                    this.#watch?.delete(filename);
                }
                await this.dev(undefined, undefined, true);
            }));
        }
        async *[Symbol.asyncIterator]() {
            const entry = resolve(process.cwd(), this.#entry);
            const dir = dirname(entry);
            const entrypoints: string[] = [];
            if (Bun.main)
                this.#watchFile(entry);
            const html = new HTMLRewriter()
                .on('head script', {
                    element(element) {
                        if (element.getAttribute('type') !== 'module')
                            return;
                        const src = element.getAttribute('src');
                        if (!src)
                            return;
                        if (src.startsWith('./') || src.startsWith('../')) {
                            entrypoints.push(resolve(dir, unescapeHTML(src)));
                            element.remove();
                            return;
                        }
                    },
                })
                .transform(Bun.mmap(entry)) as unknown as ArrayBuffer;
            const { outputs, success, logs } = await Bun.build({
                entrypoints,
                target: 'browser',
                root: process.cwd(),
                naming: '[name].[hash].[ext]',
                splitting: true,
                minify: process.env.NODE_ENV === 'production',
                sourcemap: process.env.NODE_ENV === 'production' ? 'none' : 'linked',
            });
            if (success) {
                console.debug('[build] %o', new Date());
            } else {
                if (!logs.length)
                    console.error('[build] %o', new Date());
                for (const message of logs) {
                    console.error('[build] %o\n%o', new Date(), message);
                    if (Bun.main && message.position?.file)
                        this.#watchFile(message.position.file);
                }
                if (process.env.NODE_ENV === 'production')
                    process.exit(1);
            }
            const script: `/${string}`[] = [];
            for (const output of outputs) {
                const path = `/${basename(output.path)}` as const;
                if (output.kind === 'entry-point')
                    script.push(path);
                if (Bun.main) {
                    const sources: string[] | undefined = (await output.sourcemap?.json())?.sources;
                    if (!sources)
                        continue;
                    for (const filename of sources)
                        this.#watchFile(resolve(process.cwd(), filename));
                }
                yield [path, Buffer.from(await output.arrayBuffer()), output.type] as const;
            }
            yield [
                '/',
                Buffer.from(new HTMLRewriter()
                    .on('head', {
                        element(element) {
                            element.onEndTag((end) => {
                                for (const path of script)
                                    end.before(`<script type="module" src="${Bun.escapeHTML(path)}"></script>`, { html: true });
                            });
                        },
                    })
                    .on('body', {
                        element(element) {
                            if (process.env.NODE_ENV === 'production')
                                for (const message of logs)
                                    element.prepend(`<pre>${Bun.escapeHTML(JSON.stringify(message, null, 2))}<pre>`, { html: true });
                        },
                    })
                    .transform(html) as unknown as ArrayBuffer),
                'text/html;charset=utf-8',
            ] as const;
        }
        async dev(server?: Server, entry?: string, rebuild = false) {
            if (server)
                this.#server = server;
            if (entry && entry !== this.#entry) {
                this.#entry = entry;
                rebuild = true;
            }
            if (!rebuild && this.#map)
                return this.#map;
            this.#map ??= new Map();
            this.#map.clear();
            for await (const [path, body, type] of this)
                this.#map.set(path, { body, type });
            this.#server?.publish('build', Date());
            return this.#map;
        }
    };
}

async function staticDataEncode() {
    const encodeData: Partial<Record<BufferEncoding, Record<string, Record<`/${string}`, string>>>> = {};
    if (process.env.NODE_ENV === 'production') {
        for await (const [path, body, type] of staticData()) {
            const encoding = type.startsWith('text/') ? 'utf-8' : 'base64';
            encodeData[encoding] ??= {};
            encodeData[encoding][type] ??= {};
            encodeData[encoding][type][path] = body.toString(encoding);
            console.debug('[assets] %o path=%s type=%s', new Date(), path, type);
        }
    }
    return encodeData;

    async function* staticData() {
        yield* build();
        for await (const filename of Bun.$`bash -c ${`
            function readdir() {
                for file in $(ls $1); do
                    if [ -d $1"/"$file ]; then
                        readdir $1"/"$file
                    else
                        echo $1"/"$file
                    fi
                done
            }
            readdir ${Bun.$.escape(resolve(process.cwd(), assets))}
        `}`.lines()) {
            if (filename)
                yield [`/${relative(process.cwd(), filename)}`, Buffer.from(Bun.mmap(filename)), Bun.file(filename).type] as const;
        }
    }
}

declare global {
    var $build: ReturnType<typeof build> | undefined;
}

async function dev(pathname: string, server: Server) {
    const buildList = await (global.$build ??= build()).dev(server, entry);
    const output = buildList.get(pathname as `/${string}`);
    if (output)
        return new Response(output.body, { headers: { 'Content-Type': output.type } });
    if (!pathname.startsWith(`/${assets}`))
        return;
    const fd = Bun.file(`${process.cwd()}${pathname}`);
    if (await fd.exists())
        return new Response(fd);
}

function staticData() {
    const data = new Map<`/${string}`, Response>();
    const entries: Entries = Object.entries;
    for (const [encoding, map] of entries(staticDataEncode_macro() as unknown as Awaited<ReturnType<typeof staticDataEncode_macro>>))
        for (const [type, route] of entries(map))
            for (const [path, text] of entries(route))
                data.set(path, new Response(Buffer.from(text, encoding), { headers: { 'Content-Type': type } }));
    return data;

    type Entries = <T extends object>(o: T) => [T extends Partial<Record<infer K, any>> ? K : never, T extends Record<any, infer V> ? V : never][];
}

export { dev, staticData };
export { staticDataEncode as staticDataEncode_macro };
