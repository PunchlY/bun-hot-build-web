import type { Serve } from 'bun';
import { resolve, relative, basename, dirname } from 'path';
import { watch, type FSWatcher } from 'fs';
import { staticDataEncode_macro } from './client-serve' with { type: 'macro' };
import { unescapeHTML } from './lib/html';

const entry = 'index.html', assets = 'public';

function build() {
    return new class Build {
        #entry = entry;
        #map?: Map<`/${string}`, Response>;
        #watch?: Map<string, FSWatcher>;
        get entry() {
            return this.#entry;
        }
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
                await this.dev(undefined, true);
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
                .transform(new Response(Bun.mmap(entry), { headers: { 'Content-Type': 'text/html;charset=utf-8' } }));
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
                yield [path, output] as const;
            }
            yield [
                '/',
                await new HTMLRewriter()
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
                    .transform(html)
                    .blob(),
            ] as const;
        }
        async dev(entry?: string, rebuild = false) {
            if (entry && entry !== this.#entry) {
                this.#entry = entry;
                rebuild = true;
            }
            if (!rebuild && this.#map)
                return this.#map;
            this.#map ??= new Map();
            this.#map.clear();
            for await (const [path, blob] of this)
                this.#map.set(path, new Response(blob));
            return this.#map;
        }
    };
}

async function staticDataEncode() {
    const encodeData: Partial<Record<BufferEncoding, Record<string, Record<`/${string}`, string>>>> = {};
    if (process.env.NODE_ENV === 'production') {
        for await (const [path, res] of staticData()) {
            const { type } = res;
            const encoding = type.startsWith('text/') ? 'utf-8' : 'base64';
            encodeData[encoding] ??= {};
            encodeData[encoding][type] ??= {};
            encodeData[encoding][type][path] = Buffer.from(await res.arrayBuffer()).toString(encoding);
            console.debug('[assets] %o path=%s type=%s', new Date(), path, res.type);
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
                yield [`/${relative(process.cwd(), filename)}`, new Blob([Bun.mmap(filename)], { type: Bun.file(filename).type })] as const;
        }
    }
}

declare global {
    var $build: ReturnType<typeof build> | undefined;
}

const notFound = /* @__PURE__ */ new Response('Not Found', { status: 404 });

async function dev(pathname: string) {
    global.$build ??= build();
    const buildList = await global.$build.dev(entry);
    const output = buildList.get(pathname as `/${string}`);
    if (output)
        return output;
    if (!pathname.startsWith(`/${assets}`))
        return;
    const fd = Bun.file(`${process.cwd()}${pathname}`);
    if (await fd.exists())
        return new Response(fd);
}

type FromEntries = <K extends PropertyKey, V>(entries: Iterable<readonly [K, V]>) => Record<K, V>;
type Entries = <T extends object>(o: T) => [T extends Partial<Record<infer K, any>> ? K : never, T extends Record<any, infer V> ? V : never][];
let staticData: Serve['static'];
export default {
    get static() {
        return staticData ??= (Object.fromEntries as FromEntries)(staticDataDecode());
        function* staticDataDecode() {
            const entries: Entries = Object.entries;
            for (const [encoding, map] of entries(staticDataEncode_macro() as unknown as Awaited<ReturnType<typeof staticDataEncode_macro>>))
                for (const [type, route] of entries(map))
                    for (const [path, text] of entries(route))
                        yield [path, new Response(Buffer.from(text, encoding), { headers: { 'Content-Type': type } })] as const;
        }
    },
    async fetch(request) {
        if (process.env.NODE_ENV !== 'production') {
            const { url } = request;
            const pathIndex = url.indexOf('/', 8);
            const queryIndex = url.indexOf('?', pathIndex);
            const path = queryIndex === -1 ? url.substring(pathIndex) : url.substring(pathIndex, queryIndex);
            return await dev(path) || notFound;
        }
        return notFound;
    }
} satisfies Serve;
export { dev };
export { staticDataEncode as staticDataEncode_macro };
