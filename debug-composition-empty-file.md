[OPEN] composition-empty-file

# Debug Session

- Session ID: composition-empty-file
- Started At: 2026-04-04
- Scope: 检查拼接失败任务的原因，并在对应输出文件为空时删除该任务

## Symptoms

- 拼接项目列表出现失败任务
- 错误包含 `spawn /ROOT/node_modules/ffmpeg-static/ffmpeg ENOENT`、`terminated`
- 用户希望检查原因，并在关联文件为空时删除任务

## Hypotheses

1. 失败任务对应的输出文件路径不存在，页面仍保留了失败记录。
2. 失败任务对应的输出文件存在但为空文件，需要把无效记录删除。
3. 某些失败任务没有输出文件，真正需要删除的是 composition store 中的记录，而不是文件本身。
4. FFmpeg 可执行文件路径失效是历史环境问题，当前页面只是继续展示旧失败记录。
5. 当前删除逻辑已经存在，只是页面没有暴露，或失败记录没有联动清理。

## Evidence

- `data/video-compositions.json` 中共有 2 条失败记录：
  - `9a7dafd2-af63-4ae8-91e9-79f73a4e5db6`，错误 `terminated`，`outputVideoUrl = null`
  - `dcd31046-6224-4868-95fd-9094b14ee281`，错误 `spawn /ROOT/node_modules/ffmpeg-static/ffmpeg ENOENT`，`outputVideoUrl = null`
- `public/generated-compositions` 中现存 4 个 mp4 文件，大小分别为：
  - `3d2faa0d-e722-4ddf-bc79-43679eac0187.mp4` → 1673906
  - `92c985ee-b0d7-450a-be9b-00d565b250b3.mp4` → 2530529
  - `93c3b69e-d56d-4005-b103-3bb52b8b7313.mp4` → 1673906
  - `b91b43af-fba6-403e-96ff-e9dca4a5352b.mp4` → 1673906
- 没有发现 0 字节成片文件；失败记录对应的是“没有输出文件”的旧任务。

## Findings

1. 假设 1 成立：失败任务只是旧记录，对应输出文件不存在。
2. 假设 2 不成立：当前生成目录中没有空文件。
3. 假设 3 成立：需要删除的是 composition store 中的失败记录。
4. 假设 4 成立：`ffmpeg ENOENT` 和 `terminated` 都是历史失败原因，当前页面只是继续展示旧任务。
