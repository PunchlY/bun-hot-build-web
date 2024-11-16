# Bun The Build Tool For The Web

基于[bun](https://bun.sh/)的前端构建解决方案.

Front-end building solution based on [bun](https://bun.sh/).

- [x] 热构建
- [ ] 多入口点

## Development

```bash
bun run dev &
curl http://127.0.0.1:3000/

#bun > $ NODE_ENV=development bun run --hot index.ts
#bun > [build] 2024-11-16T09:40:07.975Z
#bun > [watch] 2024-11-16T09:41:41.192Z filename=/var/www/bun-web/index.html
#bun > [build] 2024-11-16T09:41:41.196Z
#bun > [watch] 2024-11-16T09:41:41.196Z filename=/var/www/bun-web/client.ts
#curl> <!DOCTYPE html>
#curl> <html>

#curl> <head>
#curl>     <title>Bun Web</title>
#curl>     
#curl> <script type="module" src="/client.xt1vn108.js"></script></head>
#curl> 
#curl> <body>
#curl>     <p>hello.</p>
#curl> </body>
#curl> 
#curl> </html>
```

## Build

```bash
bun run build

#bun> $ NODE_ENV=production bun build index.ts --target=bun --minify --outfile=dist/index.js
#bun> [build] 2024-11-16T09:15:16.071Z
#bun> [assets] 2024-11-16T09:15:16.071Z path=/client.2rpzt924.js type=text/javascript;charset=utf-8
#bun> [assets] 2024-11-16T09:15:16.071Z path=/ type=text/html;charset=utf-8
#bun> [assets] 2024-11-16T09:15:16.075Z path=/public/robots.txt type=text/plain;charset=utf-8
#bun> 
#bun>   index.js  0.73 KB
#bun> 
#bun> [30ms] bundle 3 modules
```
