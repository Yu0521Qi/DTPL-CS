# 零依赖镜像：仅用 Node 官方运行时，无需 npm install（无第三方依赖）
FROM node:20-alpine
WORKDIR /app

# 仅复制必要的运行文件（data/ 由 .dockerignore 排除，运行时再生成）
COPY package.json server.js ./
COPY assets ./assets
COPY index.html admin.html ./

ENV PORT=3000
EXPOSE 3000

# 若挂载持久卷，请在平台把卷挂到 /data 并设置环境变量 DATA_DIR=/data
CMD ["node", "server.js"]
