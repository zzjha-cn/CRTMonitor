import { readFileSync, writeFileSync, accessSync, watchFile } from "node:fs";
// @ts-ignore
import * as yaml from "js-yaml";
import { TrainInfo, ChinaRailway, TrainTickets, TrainQuerier, ExtendStationCfg, StationData } from "./cr.js";
import { Notifications } from "./notifications.js";
import { sleep, time, log, asset } from "./utils.js";
import moment from "moment";

interface SearchConfig {
  date: string;
  from: string;
  to: string;
  trains_filter?: {
    from: string[];
    to: string[];
    beginHour: number;
    endHour: number;
    fromTeleCode?: string[];
    toTeleCode?: string[];
  };
  seatCategory?: string[];
  trains?: TrainConfig[];
}

interface TrainConfig {
  code: string;
  from?: string;
  to?: string;
  seatCategory?: string[];
  checkRoundTrip?: boolean;
}

interface NotificationConfig {
  type: string;
  [key: string]: any;
}

interface Config {
  watch: SearchConfig[];
  notifications: NotificationConfig[];
  interval?: number;
  delay?: number;
}

interface Message {
  time: string;
  content: string;
}

interface RemainTicketsResult {
  train_no: string;
  from_station_telecode: string;
  to_station_telecode: string;
  start_time: string;
  arrive_time: string;
  remain: boolean;
  total?: string | number;
  msg?: string;
}

// 冗余查询的模式
type ExtendMode = 'destination' | 'origin' | 'both'

let config: Config;
let notifications: any[] = [];
let updateTimer: NodeJS.Timeout | null = null;

function die(err?: any): void {
  if (err && err != "SIGINT") {
    log.error("发生错误：", err);
    log.line();
  }
  sendMsg({
    time: new Date().toLocaleString(),
    content: `车票监控程序异常退出：${err?.message || err}`,
  });
  log.info("程序已结束，将在 5 秒后退出");
  process.exit();
}

function clean(): void {
  for (let notification of notifications) {
    notification.die();
  }
  if (updateTimer) {
    clearInterval(updateTimer);
    clearTimeout(updateTimer);
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
}

async function sendMsg(msg: Message): Promise<void> {
  for (let notification of notifications) {
    if (notification.info.name === "飞书推送") {
      const formattedMsg = `[车票监控]\n🕒 时间：${msg.time}\n📝 内容：${msg.content}`;
      notification.send(formattedMsg).catch((err: any) => {
        log.error(
          `${notification.info.name} (${notification.info.description}) 发送失败：${err}`
        );
      });
    } else if (notification.info.name === "Telegram推送") {
      const formattedMsg = `🚄 *车票监控*\n\n🕒 *时间：* ${msg.time}\n📝 *内容：* ${msg.content}`;
      notification.send(formattedMsg).catch((err: any) => {
        log.error(
          `${notification.info.name} (${notification.info.description}) 发送失败：${err}`
        );
      });
    } else if (notification.info.name === "企业微信推送") {
      const formattedMsg = `[车票监控]\n🕒 时间：${msg.time}\n📝 内容：${msg.content}`;
      notification.send(formattedMsg).catch((err: any) => {
        log.error(
          `${notification.info.name} (${notification.info.description}) 发送失败：${err}`
        );
      });
    } else {
      notification.send(msg).catch((err: any) => {
        log.error(
          `${notification.info.name} (${notification.info.description}) 发送失败：${err}`
        );
      });
    }
  }
}

async function transformSearch(search: SearchConfig): Promise<SearchConfig> {
  if (search.trains_filter) {
    let fcode: string[] = [];
    let tcode: string[] = [];
    for (let f of search.trains_filter.from) {
      fcode.push(await ChinaRailway.getStationCode(f) || "")
    }
    for (let f of search.trains_filter.to) {
      tcode.push(await ChinaRailway.getStationCode(f) || "")
    }
    fcode = [...new Set(fcode.concat(search.trains_filter.fromTeleCode || []))];
    tcode = [...new Set(tcode.concat(search.trains_filter.toTeleCode || []))];
    search.trains_filter.fromTeleCode = fcode;
    search.trains_filter.toTeleCode = tcode;
  }
  return search
}

async function searchTickets(search: SearchConfig): Promise<void> {
  log.info(`查询 ${search.date} ${search.from}→${search.to} 车票：`);
  let fromCode = (await ChinaRailway.getStationCode(search.from)) || "";
  let toCode = (await ChinaRailway.getStationCode(search.to)) || "";
  let data = await ChinaRailway.checkTickets(
    search.date,
    fromCode,
    toCode,
  );
  let foundTicket = false;
  let parseTrainList = data.data.result
    .map((item) => { return ChinaRailway.parseTrainInfo(item) })

  parseTrainList = parseTrainList.filter((item) => { // 筛选想要的
    const fromTrue = search.trains_filter?.from === undefined ||
      search.trains_filter?.from.includes(
        ChinaRailway.stationName[item.from_station_telecode]
      );
    const toTrue = search.trains_filter?.to === undefined ||
      search.trains_filter?.to.includes(
        ChinaRailway.stationName[item.to_station_telecode]
      );
    const beginTrue = search.trains_filter?.beginHour === undefined ||
      parseInt(item.start_time.slice(0, 2)) >= search.trains_filter?.beginHour;
    const endTrue = search.trains_filter?.endHour === undefined ||
      parseInt(item.arrive_time.slice(0, 2)) <= search.trains_filter?.endHour;
    return fromTrue && toTrue && beginTrue && endTrue;
  });
  parseTrainList = parseTrainList.filter((item) => {
    // 筛选特定的站点（比如一定要广州南出发，到达哪里）
    if (!search.trains) {
      return true
    }
    if (search.trains) {
      for (let train of search.trains) {
        if (
          train.code == item.station_train_code &&
          (train.from === undefined ||
            train.from ==
            ChinaRailway.stationName[item.from_station_telecode]) &&
          (train.to === undefined ||
            train.to == ChinaRailway.stationName[item.to_station_telecode])
        ) {
          return true
        }
      }
    }
    return false
  });

  // 检查主线路是否有余票
  for (let trainInfo of parseTrainList) {
    // foundTicket = await determineRemainTickets(trainInfo, search.seatCategory)
    await determineRemainTickets(trainInfo, search.seatCategory)
  }
  // if (foundTicket) {
  // return
  // }

  // 冗余终点站查询
  const extendedStations = await getExtendedStations(parseTrainList, "destination");
  if (extendedStations.length > 0) {
    const groupedQueries = groupQueriesByStation(extendedStations, search);

    for (const queries of groupedQueries) {
      if (await processStationQueries(queries)) {
        // foundTicket = true;
        // return;
      }
    }
  }
  if (foundTicket) {
    return;
  }


  // 冗余起点站
  console.log("冗余起点站");
  const extendedStations2 = await getExtendedStations(parseTrainList, "origin");
  if (extendedStations2.length > 0) {
    const groupedQueries2 = groupQueriesByStation(extendedStations2, search);

    for (const queries of groupedQueries2) {
      if (await processStationQueries(queries)) {
        // foundTicket = true;
        // return;
      }
    }
  }
  if (foundTicket) {
    return;
  }

  // 冗余起点与终点
  console.log("冗余起点与终点");
  let extendedStationsAll = extendedStations.map((item) => {
    let fr = extendedStations2.find(i2 => i2.trainCode === item.trainCode)
    if (fr) {
      item.from = fr.from
    }
    return item
  })
  if (extendedStationsAll.length > 0) {
    const groupedQueries = groupQueriesByStation(extendedStationsAll, search);

    for (const queries of groupedQueries) {
      if (await processStationQueries(queries)) {
        // foundTicket = true;
        // return;
      }
    }
  }

  // 结束
  console.log("结束");
}

// 类型守卫：检查StationData是否有效
function isValidStationData(station: StationData | undefined): station is StationData {
  return station !== undefined &&
    station !== null &&
    typeof station.station_code === 'string' &&
    station.station_code.length > 0;
}

// 安全获取站点数据的辅助函数
function findStationSafely(stations: StationData[], stationCode: string): StationData | undefined {
  if (!Array.isArray(stations) || stations.length === 0) {
    return undefined;
  }
  return stations.find(item => item?.station_code === stationCode);
}

// 获取扩展站点信息
async function getExtendedStations(parseTrainList: TrainInfo[], mode: ExtendMode = "destination"): Promise<ExtendStationCfg[]> {
  const extendedStations: ExtendStationCfg[] = [];

  for (const trainInfo of parseTrainList) {
    try {
      const targetStationCode = mode === 'destination'
        ? trainInfo.to_station_telecode
        : trainInfo.from_station_telecode;

      // 防御性检查：确保必要的参数存在
      if (!trainInfo.train_no || !trainInfo.from_station_telecode || !trainInfo.to_station_telecode) {
        console.warn(`跳过无效的列车信息: ${trainInfo.station_train_code}`);
        continue;
      }

      const stationList = await ChinaRailway.getTrainAllStations(
        trainInfo.train_no,
        trainInfo.from_station_telecode,
        trainInfo.to_station_telecode,
        moment(trainInfo.start_train_date).format("YYYY-MM-DD").toString(),
        sleep(1000)
      );

      // 使用可选链和空值合并进行安全检查
      const stationData = stationList?.data;
      if (!Array.isArray(stationData) || stationData.length <= 2) {
        continue;
      }

      // 安全的数组操作
      const workingData = mode === 'origin' ? [...stationData].reverse() : stationData;

      const targetIndex = workingData.findIndex(item => item?.station_code === targetStationCode);
      if (targetIndex <= 0 || targetIndex >= workingData.length - 1) {
        continue;
      }

      // 计算目标索引，使用安全的边界检查
      const isNearEnd = workingData.length - 1 - 2 === targetIndex;
      const nextIndex = isNearEnd ? workingData.length - 1 : targetIndex + 1;

      // 确保索引在有效范围内
      if (nextIndex < 0 || nextIndex >= workingData.length) {
        continue;
      }

      // 安全获取站点数据
      const fromStation = mode === 'destination'
        ? findStationSafely(workingData, trainInfo.from_station_telecode)
        : workingData[nextIndex];

      const toStation = mode === 'destination'
        ? workingData[nextIndex]
        : findStationSafely(workingData, trainInfo.to_station_telecode);

      // 只有当站点数据有效时才添加到结果中
      if (isValidStationData(fromStation) && isValidStationData(toStation)) {
        extendedStations.push({
          trainCode: trainInfo.train_no,
          from: fromStation,
          to: toStation
        });
      } else {
        console.warn(`跳过无效的站点数据: ${trainInfo.station_train_code}`);
      }
    } catch (error) {
      console.error(`处理列车 ${trainInfo.station_train_code} 时发生错误:`, error);
      // 继续处理下一个列车，不中断整个流程
      continue;
    }
  }

  return extendedStations;
}

// 按站点分组查询
// 因为车次的查询与起点终点相关，为了减少查询次数，针对起点终点聚合，然后一次性查出来
function groupQueriesByStation(extendedStations: ExtendStationCfg[], search: SearchConfig): TrainQuerier[][] {
  const queryMap = new Map<string, TrainQuerier[]>();

  // 安全的键生成函数
  const makeKey = (item: ExtendStationCfg): string | null => {
    // 使用类型守卫确保站点数据有效
    if (!isValidStationData(item.from) || !isValidStationData(item.to)) {
      return null;
    }
    return `${item.from.station_code}_${item.to.station_code}`;
  };

  for (const station of extendedStations) {
    try {
      const key = makeKey(station);
      if (!key) {
        console.warn(`跳过无效的站点配置: ${station.trainCode}`);
        continue;
      }

      if (!queryMap.has(key)) {
        queryMap.set(key, []);
      }

      // 使用非空断言操作符，因为我们已经通过类型守卫验证了数据
      const queries = queryMap.get(key)!;
      queries.push({
        arriveTime: station.to!.arrive_time || "",
        fromCode: station.from!.station_code,
        toCode: station.to!.station_code,
        date: search.date,
      });
    } catch (error) {
      console.error(`处理站点分组时发生错误:`, error);
      continue;
    }
  }

  return Array.from(queryMap.values());
}

// 处理站点查询
async function processStationQueries(queries: TrainQuerier[]): Promise<boolean> {
  if (!Array.isArray(queries) || queries.length === 0) {
    console.warn('查询列表为空或无效');
    return false;
  }

  try {
    const info = queries[0];
    if (!info) {
      console.warn('查询参数无效');
      return false;
    }

    // 验证必要的查询参数
    if (!info.fromCode || !info.toCode || !info.date) {
      console.warn('查询参数不完整:', info);
      return false;
    }

    const arrTimeList = queries.map(q => q.arriveTime);
    if (arrTimeList.length === 0) {
      console.warn('没有有效的到达时间');
      return false;
    }

    const data = await ChinaRailway.checkTickets(
      info.date,
      info.fromCode,
      info.toCode,
      sleep(1000)
    );

    if (!data?.status || !data?.data?.result) {
      console.warn('查询结果为空或格式无效');
      return false;
    }

    const newTicketList = data.data.result
      .map(item => {
        try {
          return ChinaRailway.parseTrainInfo(item);
        } catch (error) {
          console.error('解析列车信息时发生错误:', error);
          return null;
        }
      })
      .filter((item): item is TrainInfo => item !== null && arrTimeList.includes(item.arrive_time));

    if (newTicketList.length === 0) {
      console.log('未找到匹配的列车');
      return false;
    }

    let hasTickets = false;
    for (const trainInfo of newTicketList) {
      try {
        if (await determineRemainTickets(trainInfo)) {
          hasTickets = true;
          // 可以选择在找到第一张票时就返回，或继续检查所有列车
          // return true;
        }
      } catch (error) {
        console.error(`检查列车 ${trainInfo.station_train_code} 余票时发生错误:`, error);
        continue;
      }
    }

    return hasTickets;
  } catch (error) {
    console.error('处理站点查询时发生错误:', error);
    return false;
  }
}

async function determineRemainTickets(
  trainInfo: TrainInfo,
  seatCategory?: string[],
  checkRoundTrip: boolean = false
): Promise<boolean> {
  let trainDescription =
    trainInfo.station_train_code +
    " " +
    (await ChinaRailway.getStationName(trainInfo.from_station_telecode)) +
    "→" +
    (await ChinaRailway.getStationName(trainInfo.to_station_telecode)) +
    "(" + trainInfo.start_time + "->" + trainInfo.arrive_time + ") ";

  let ticketResp = await checkRemainTicketsV2(
    trainInfo,
    seatCategory,
  );

  // TODO：优化发送结构。
  let { remain, msg } = ticketResp;
  msg = msg || "无剩余票";

  if (!remain && seatCategory !== undefined) {
    msg = seatCategory.join("/") + " " + msg;
  }

  log.info("-", trainDescription, msg);

  if (remain) {
    const messageToSend: Message = {
      time: new Date().toLocaleString(),
      content: trainDescription + "\n" + msg,
    };

    sendMsg(messageToSend);
    return true
  }
  return false
}

async function checkRemainTicketsV2(
  trainInfo: TrainInfo,
  seatCategory?: string[],
): Promise<RemainTicketsResult> {
  let remainTypes: string[] = [];
  let remainTotal = 0;
  for (let type of Object.keys(trainInfo.tickets)) {
    if (seatCategory !== undefined && !seatCategory.includes(type)) {
      continue;
    }
    if (trainInfo.tickets[type as keyof TrainTickets] != "" && trainInfo.tickets[type as keyof TrainTickets] != "无") {
      remainTypes.push(type + " " + trainInfo.tickets[type as keyof TrainTickets]);
      if (trainInfo.tickets[type as keyof TrainTickets] == "有") {
        remainTotal += Infinity;
      } else {
        remainTotal += parseInt(trainInfo.tickets[type as keyof TrainTickets]);
      }
    }
  }
  if (remainTypes.length) {
    return {
      train_no: trainInfo.train_no,
      from_station_telecode: trainInfo.from_station_telecode,
      start_time: trainInfo.start_time,
      to_station_telecode: trainInfo.to_station_telecode,
      arrive_time: trainInfo.arrive_time,
      remain: true,
      total: remainTotal >= 20 ? "≥20" : remainTotal,
      msg: remainTypes.join(" / "),
    };
  }
  return {
    train_no: "",
    from_station_telecode: "",
    start_time: "",
    to_station_telecode: "",
    arrive_time: "",
    remain: false,
    msg: "区间无票，全程未知",
  };
}


async function update(): Promise<void> {
  log.info("开始查询余票");
  try {
    for (let search of config.watch) {
      search = await transformSearch(search)
      await searchTickets(search);
      await sleep((config.delay || 1) * 1000);
    }
    ChinaRailway.clearTicketCache();
  } catch (e: any) {
    log.error(e);
    sendMsg({
      time: new Date().toLocaleString(),
      content: "错误：" + e.message,
    });
  }
  log.info("余票查询完成");
  log.line();
}

function checkConfig(): void {
  let configContent: string = "";
  try {
    configContent = readFileSync("config.yml", "utf-8");
  } catch (err: any) {
    if (err.code == "ENOENT") {
      log.error("config.yml 不存在");
      try {
        writeFileSync("config.yml", asset("config.example.yml"));
        log.info("已自动创建 config.yml");
        log.info("请根据需要修改后重启程序");
      } catch (err) {
        log.error("创建 config.yml 失败");
        log.info("请自行创建后重启程序");
      }
    } else {
      log.error("读取 config.yml 时发生错误：", err);
    }
    die("配置文件错误");
  }
  try {
    config = yaml.load(configContent) as Config;
  } catch (err) {
    log.error("解析 config.yml 时发生错误：", err);
    die("配置文件解析错误");
  }

  let configParsing = "当前配置文件：\n\n";
  if (!config.watch || !config.watch.length) {
    log.error("未配置搜索条件");
    die();
  }
  for (let search of config.watch) {
    if (!search.date || !search.from || !search.to) {
      log.error("搜索条件不完整");
      die();
    }
    configParsing += search.date + " " + search.from + "→" + search.to + "\n";
    if (search.trains && search.trains.length) {
      for (let train of search.trains) {
        if (!train.code) {
          log.error("未填写车次号");
          die();
        }
        configParsing +=
          "- " +
          train.code +
          " " +
          (train.from ?? "(*)") +
          "→" +
          (train.to ?? "(*)") +
          " " +
          (train.seatCategory ? train.seatCategory.join("/") : "全部席别") +
          " " +
          (train.checkRoundTrip ? "[✓]" : "[×]") +
          "查询全程票\n";
      }
    } else {
      configParsing += "- 全部车次\n";
    }
    configParsing += "\n";
  }

  // 清理旧的通知实例
  for (let notification of notifications) {
    notification.die();
  }
  notifications = [];

  if (config.notifications.length) {
    for (let notification of config.notifications) {
      try {
        let n = new (Notifications as any)[notification.type](notification); // 确保实例化时使用正确的键名
        notifications.push(n);
        configParsing +=
          `已配置消息推送：${n.info.name} (${n.info.description})` + "\n";
      } catch (e) {
        log.error("配置消息推送时发生错误：", e);
      }
    }
  }

  if (!notifications.length) {
    log.warn("未配置消息推送");
    configParsing += "未配置消息推送\n";
  }

  configParsing += "\n";

  if (!config.interval) config.interval = 15;
  if (!config.delay) config.delay = 5;
  configParsing += `查询间隔：${config.interval}分钟，访问延迟：${config.delay}秒`;

  log.line();
  log.direct(configParsing);
  log.line();

  sendMsg({
    time: new Date().toLocaleString(),
    content: configParsing,
  }).then(() => {
    log.info("已尝试发送提醒，如未收到请检查配置");
  });
}

function reloadConfig(): void {
  log.info("检测到配置文件变化，正在重新加载...");

  // 清除现有定时器
  if (updateTimer) {
    clearInterval(updateTimer);
    clearTimeout(updateTimer);
    updateTimer = null;
  }

  try {
    checkConfig();

    // 重新启动定时器
    startMonitoring();

    log.info("配置文件重新加载完成");
    sendMsg({
      time: new Date().toLocaleString(),
      content: "配置文件已重新加载，监控已重新启动",
    });
  } catch (err: any) {
    log.error("重新加载配置文件失败：", err);
    sendMsg({
      time: new Date().toLocaleString(),
      content: `配置文件重新加载失败：${err.message || err}`,
    });
  }
}

function startMonitoring(): void {
  log.info("5秒后开始首次查询，按 Ctrl+C 中止");
  updateTimer = setInterval(update, (config.interval || 5) * 60 * 1000);
  setTimeout(update, 5 * 1000);
}

function watchConfigFile(): void {
  try {
    watchFile("config.json", { interval: 1000 }, (curr, prev) => {
      if (curr.mtime > prev.mtime) {
        // 延迟一下，确保文件写入完成
        setTimeout(reloadConfig, 500);
      }
    });
    log.info("已启用配置文件热重载监控");
  } catch (err) {
    log.warn("启用配置文件监控失败：", err);
  }
}

process.title = "CR Ticket Monitor";
process.on("uncaughtException", die);
process.on("unhandledRejection", die);
process.on("SIGINT", die);
process.on("exit", clean);

async function main(): Promise<void> {
  console.clear();
  log.title(String.raw`
           __________  ________  ___
          / ____/ __ \/_  __/  |/  /
         / /   / /_/ / / / / /|_/ /
        / /___/ _  _/ / / / /  / /
        \____/_/ |_| /_/ /_/  /_/

`);
  log.line();

  // 检查命令行参数
  const args = process.argv.slice(2);
  if (args.includes("--monitor") || args.includes("-m")) {
    // 直接启动监控模式
    log.info("直接启动监控模式");
    startMonitoringMode();
    return;
  }

  // 检查配置文件是否存在
  try {
    accessSync("config.yml");

    // 配置文件存在，询问用户选择模式
    log.info("检测到配置文件 config.yml");
    log.info("请选择运行模式：");
    log.info("1. 直接启动监控 (输入 1)");
    log.info("2. 进入交互配置模式 (输入 2)");
    log.info("或者等待 5 秒自动启动监控模式");
    log.line();

    // 等待用户输入或超时
    const { createInterface } = await import("readline");
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let userChoice = false;
    const timeout = setTimeout(() => {
      if (!userChoice) {
        rl.close();
        log.info("自动选择监控模式");
        startMonitoringMode();
      }
    }, 5000);

    rl.on("line", (input: string) => {
      userChoice = true;
      clearTimeout(timeout);
      rl.close();

      const choice = input.trim();
      if (choice === "1" || choice === "") {
        log.info("启动监控模式...");
        startMonitoringMode();
      } else if (choice === "2") {
        log.info("进入交互配置模式...");
        import("./cli.js");
      } else {
        log.info("无效输入，启动监控模式...");
        startMonitoringMode();
      }
    });
  } catch (err) {
    // 配置文件不存在，直接启动交互模式
    log.warn("未找到配置文件 config.yml");
    log.info("启动交互配置模式...");
    log.line();
    import("./cli.js");
  }
}

function startMonitoringMode(): void {
  checkConfig();
  watchConfigFile();
  startMonitoring();
}

// 启动主程序
main();
