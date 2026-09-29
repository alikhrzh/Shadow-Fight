# ShadowCoach web

React/Vite-интерфейс пошагового образовательного тренера. Запускайте команды из
`unified`, чтобы подготовить Full-модель, WASM и classic worker:

```sh
cd ../..
npm ci
npm run model:download
npm run dev
```

Интерфейс и локальный NVIDIA endpoint доступны на одном адресе. Камера запрашивается
только после урока. Полное описание сценария, конфигурации, тестов и ограничений:
[README репозитория](../../../README.md).
