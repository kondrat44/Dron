/* Где лежит опубликованное расписание. Чтобы перенести сайт в другой репозиторий или на свой хостинг, меняется только этот файл. */
window.RASP = {
  owner: "kondrat44",
  repo: "Dron",
  branch: "main",
  path: "rasp/data/schedule.json", // путь файла в репозитории
  data: "data/schedule.json", // тот же файл, как его видит сайт
  hour: 24, // во сколько студенты видят обычные изменения («Изменить расписание»): 24 = в полночь (00:00); новое и срочное — сразу
  title: "КузТАГиС",
  push: "https://rasp-push.hthtt5664.workers.dev", // сервер уведомлений о заменах (Cloudflare, папка push/)
  pushKey: "BCU7BrMsYnOuwqzLoxvl6O1FKcnxNr85oBaWddPn-VwMbxWqnm6hLKqJcW6j5spfrXVLE4SdDgnSpSboWBQI9UU", // открытый ключ сервера уведомлений
  v: "20261114022509", // версия сборки, ставится автоматически
};
