import { ChinaRailway, TrainInfo, ExtendStationCfg, TrainQuerier, StationData, TicketResponse, TrainTickets } from "./cr.js";
import { SearchConfig, TrainConfig } from "./config.js";
import { NotificationManager } from "./notifications.js";
import { sleep, log } from "./utils.js";
import moment from "moment";

export type ExtendMode = 'destination' | 'origin' | 'both';

export interface RemainTicketsResult {
  train_no: string;
  from_station_telecode: string;
  to_station_telecode: string;
  start_time: string;
  arrive_time: string;
  remain: boolean;
  total?: string | number;
  msg?: string;
}

export class QueryService {
  constructor(private notificationManager: NotificationManager) {}

  async transformSearch(search: SearchConfig): Promise<SearchConfig> {
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

  async searchTickets(search: SearchConfig, collector: Map<string, string[]>): Promise<void> {
    log.info(`查询 ${search.date} ${search.from}→${search.to} 车票：`);
    let fromCode = (await ChinaRailway.getStationCode(search.from)) || "";
    let toCode = (await ChinaRailway.getStationCode(search.to)) || "";
    let data: TicketResponse;
    try {
        data = await ChinaRailway.checkTickets(
            search.date,
            fromCode,
            toCode,
        );
    } catch (e: any) {
        log.error(`查询失败: ${e.message}`);
        return;
    }

    let foundTicket = false;
    let parseTrainList = data.data.result
      .map((item) => { return ChinaRailway.parseTrainInfo(item) })

    parseTrainList = parseTrainList.filter((item) => { // 筛选想要的
        // 途径站点
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
      await this.determineRemainTickets(trainInfo, search.date, collector, search.seatCategory);
    }

    // 冗余终点站查询
    const extendedStations = await this.getExtendedStations(parseTrainList, "destination");
    if (extendedStations.length > 0) {
      const groupedQueries = this.groupQueriesByStation(extendedStations, search);
      for (const queries of groupedQueries) {
        await this.processStationQueries(queries, collector);
      }
    }

    // 冗余起点站
    // console.log("冗余起点站");
    const extendedStations2 = await this.getExtendedStations(parseTrainList, "origin");
    if (extendedStations2.length > 0) {
      const groupedQueries2 = this.groupQueriesByStation(extendedStations2, search);
      for (const queries of groupedQueries2) {
        await this.processStationQueries(queries, collector);
      }
    }

    // 冗余起点与终点
    // console.log("冗余起点与终点");
    let extendedStationsAll = extendedStations.map((item) => {
      let fr = extendedStations2.find(i2 => i2.trainCode === item.trainCode)
      if (fr) {
        item.from = fr.from
      }
      return item
    })
    // 过滤掉无效的
    extendedStationsAll = extendedStationsAll.filter(item => item.from && item.to);

    if (extendedStationsAll.length > 0) {
      const groupedQueries = this.groupQueriesByStation(extendedStationsAll, search);
      for (const queries of groupedQueries) {
        await this.processStationQueries(queries, collector);
      }
    }
  }

  private async determineRemainTickets(
    trainInfo: TrainInfo,
    date: string,
    collector: Map<string, string[]>,
    seatCategory?: string[],
  ): Promise<void> {
    const fromName = await ChinaRailway.getStationName(trainInfo.from_station_telecode);
    const toName = await ChinaRailway.getStationName(trainInfo.to_station_telecode);
    let trainDescription =
      trainInfo.station_train_code +
      " " +
      fromName +
      "→" +
      toName +
      "(" + trainInfo.start_time + "->" + trainInfo.arrive_time + ") ";

    let ticketResp = this.checkRemainTicketsV2(
      trainInfo,
      seatCategory,
    );

    let { remain, msg } = ticketResp;
    msg = msg || "无剩余票";

    if (!remain && seatCategory !== undefined) {
      msg = seatCategory.join("/") + " " + msg;
    }

    log.info("-", trainDescription, msg);

    if (remain) {
        const key = `${date}_${fromName}_${toName}`;
        if (!collector.has(key)) {
            collector.set(key, []);
        }

        // 生成购票链接
        const bookingUrl = `https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc&fs=${encodeURIComponent(fromName || "")},${trainInfo.from_station_telecode}&ts=${encodeURIComponent(toName || "")},${trainInfo.to_station_telecode}&date=${date}&flag=N,N,Y`;

        collector.get(key)!.push(trainDescription + " " + msg + `\n[购票链接](${bookingUrl})`);
    }
  }

  private checkRemainTicketsV2(
    trainInfo: TrainInfo,
    seatCategory?: string[],
  ): RemainTicketsResult {
    let remainTypes: string[] = [];
    let remainTotal = 0;
    for (let type of Object.keys(trainInfo.tickets)) {
      if (seatCategory !== undefined && !seatCategory.includes(type)) {
        continue;
      }
      const ticketKey = type as keyof TrainTickets;
      const ticketVal = trainInfo.tickets[ticketKey];

      if (ticketVal != "" && ticketVal != "无" && ticketVal != "--") {
        remainTypes.push(type + " " + ticketVal);
        if (ticketVal == "有") {
          remainTotal += Infinity;
        } else {
          const num = parseInt(ticketVal);
          if (!isNaN(num)) remainTotal += num;
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
      msg: "无票",
    };
  }

  private async getExtendedStations(parseTrainList: TrainInfo[], mode: ExtendMode = "destination"): Promise<ExtendStationCfg[]> {
    const extendedStations: ExtendStationCfg[] = [];

    for (const trainInfo of parseTrainList) {
      try {
        const targetStationCode = mode === 'destination'
          ? trainInfo.to_station_telecode
          : trainInfo.from_station_telecode;

        if (!trainInfo.train_no || !trainInfo.from_station_telecode || !trainInfo.to_station_telecode) {
          continue;
        }

        const stationList = await ChinaRailway.getTrainAllStations(
          trainInfo.train_no,
          trainInfo.from_station_telecode,
          trainInfo.to_station_telecode,
          moment(trainInfo.start_train_date).format("YYYY-MM-DD").toString(),
          sleep(100) // 减少延迟
        );

        const stationData = stationList?.data;
        if (!Array.isArray(stationData) || stationData.length <= 2) {
          continue;
        }

        const workingData = mode === 'origin' ? [...stationData].reverse() : stationData;

        const targetIndex = workingData.findIndex(item => item?.station_code === targetStationCode);
        if (targetIndex <= 0 || targetIndex >= workingData.length - 1) {
          continue;
        }

        const isNearEnd = workingData.length - 1 - 2 === targetIndex;
        const nextIndex = isNearEnd ? workingData.length - 1 : targetIndex + 1;

        if (nextIndex < 0 || nextIndex >= workingData.length) {
          continue;
        }

        const fromStation = mode === 'destination'
          ? this.findStationSafely(workingData, trainInfo.from_station_telecode)
          : workingData[nextIndex];

        const toStation = mode === 'destination'
          ? workingData[nextIndex]
          : this.findStationSafely(workingData, trainInfo.to_station_telecode);

        if (this.isValidStationData(fromStation) && this.isValidStationData(toStation)) {
          extendedStations.push({
            trainCode: trainInfo.train_no,
            from: fromStation,
            to: toStation
          });
        }
      } catch (error) {
        console.error(`处理列车 ${trainInfo.station_train_code} 扩展查询时发生错误:`, error);
        continue;
      }
    }

    return extendedStations;
  }

  private groupQueriesByStation(extendedStations: ExtendStationCfg[], search: SearchConfig): TrainQuerier[][] {
    const queryMap = new Map<string, TrainQuerier[]>();

    const makeKey = (item: ExtendStationCfg): string | null => {
      if (!this.isValidStationData(item.from) || !this.isValidStationData(item.to)) {
        return null;
      }
      return `${item.from.station_code}_${item.to.station_code}`;
    };

    for (const station of extendedStations) {
      try {
        const key = makeKey(station);
        if (!key) continue;

        if (!queryMap.has(key)) {
          queryMap.set(key, []);
        }

        const queries = queryMap.get(key)!;
        queries.push({
          arriveTime: station.to!.arrive_time || "",
          fromCode: station.from!.station_code,
          toCode: station.to!.station_code,
          date: search.date,
        });
      } catch (error) {
        continue;
      }
    }

    return Array.from(queryMap.values());
  }

  private async processStationQueries(queries: TrainQuerier[], collector: Map<string, string[]>): Promise<void> {
    if (!Array.isArray(queries) || queries.length === 0) return;

    try {
      const info = queries[0];
      if (!info || !info.fromCode || !info.toCode || !info.date) return;

      const arrTimeList = queries.map(q => q.arriveTime);

      const data = await ChinaRailway.checkTickets(
        info.date,
        info.fromCode,
        info.toCode,
        sleep(500)
      );

      if (!data?.status || !data?.data?.result) return ;

      const newTicketList = data.data.result
        .map(item => {
          try {
            return ChinaRailway.parseTrainInfo(item);
          } catch (error) {
            return null;
          }
        })
        .filter((item): item is TrainInfo => item !== null && arrTimeList.includes(item.arrive_time));

      if (newTicketList.length === 0) return;

      for (const trainInfo of newTicketList) {
        await this.determineRemainTickets(trainInfo, info.date, collector);
      }
    } catch (error) {
      console.error('处理站点查询时发生错误:', error);
    }
  }

  private isValidStationData(station: StationData | undefined): station is StationData {
    return station !== undefined &&
      station !== null &&
      typeof station.station_code === 'string' &&
      station.station_code.length > 0;
  }

  private findStationSafely(stations: StationData[], stationCode: string): StationData | undefined {
    if (!Array.isArray(stations) || stations.length === 0) {
      return undefined;
    }
    return stations.find(item => item?.station_code === stationCode);
  }
}
