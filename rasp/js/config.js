/* Где лежит опубликованное расписание. Чтобы перенести сайт в другой репозиторий или на свой хостинг, меняется только этот файл. */
window.RASP = {
  owner: "kondrat44",
  repo: "Dron",
  branch: "main",
  path: "rasp/data/schedule.json", // путь файла в репозитории
  data: "data/schedule.json", // тот же файл, как его видит сайт
  notifyHour: 18, // плановые изменения («Изменить расписание») студенты видят сразу, а уведомление приходит вечером в notifyHour:00 (позже — сразу); новое и срочное — уведомление сразу
  title: "КузТАГиС",
  push: "https://rasp-push.hthtt5664.workers.dev", // сервер уведомлений о заменах (Cloudflare, папка push/)
  pushKey: "BCU7BrMsYnOuwqzLoxvl6O1FKcnxNr85oBaWddPn-VwMbxWqnm6hLKqJcW6j5spfrXVLE4SdDgnSpSboWBQI9UU", // открытый ключ сервера уведомлений
  v: "20261114055625", // версия сборки, ставится автоматически
};
