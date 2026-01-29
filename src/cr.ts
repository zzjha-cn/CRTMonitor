import moment from "moment";
import { MemoryCache } from "./cache.js";

// 定义接口
export interface TrainTickets {
  优选一等座: string;
  高级软卧: string;
  其他: string;
  软卧: string;
  软座: string;
  特等座: string;
  无座: string;
  YB: string;
  硬卧: string;
  硬座: string;
  二等座: string;
  一等座: string;
  商务座: string;
  SRRB: string;
}

export interface TrainQuerier {
  fromCode: string;
  toCode: string;
  date: string;
  arriveTime: string;
  seatCategory?: string[];
}

export interface TrainInfo {
  secretStr: string;
  buttonTextInfo: string;
  train_no: string;
  station_train_code: string;
  start_station_telecode: string;
  end_station_telecode: string;
  from_station_telecode: string;
  to_station_telecode: string;
  start_time: string;
  arrive_time: string;
  lishi: string;
  canWebBuy: string;
  yp_info: string;
  start_train_date: string;
  train_seat_feature: string;
  location_code: string;
  from_station_no: string;
  to_station_no: string;
  is_support_card: string;
  controlled_train_flag: string;
  gg_num: string;
  gr_num: string;
  qt_num: string;
  rw_num: string;
  rz_num: string;
  tz_num: string;
  wz_num: string;
  yb_num: string;
  yw_num: string;
  yz_num: string;
  ze_num: string;
  zy_num: string;
  swz_num: string;
  srrb_num: string;
  yp_ex: string;
  seat_types: string;
  exchange_train_flag: string;
  houbu_train_flag: string;
  houbu_seat_limit: string;
  yp_info_new: string;
  dw_flag: string;
  stopcheckTime: string;
  country_flag: string;
  local_arrive_time: string;
  local_start_time: string;
  bed_level_info: string;
  seat_discount_info: string;
  sale_time: string;
  tickets: TrainTickets;
}

export interface TicketResponse {
  status: boolean;
  data: {
    result: string[];
  };
}

export interface ExtendStationCfg {
  trainCode: string;
  from: StationData | undefined;
  to: StationData | undefined;
}

export interface StationData {
  station_name: string;
  train_class_name: string;
  isChina: string;
  service_type: string;
  end_station_name: string;
  stopover_time: string;
  country_code: string;
  isEnabled: boolean;
  country_name: string;
  arrive_time: string;
  start_station_name: string;
  station_train_code: string;
  start_time: string;
  station_no: string;
  station_code: string;
}

interface TrainStationResponse {
  data: TrainStationPanl;
  httpstatus: number;
  status: boolean;
}

interface TrainStationPanl {
  data: StationData[];
}

interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier: number;
}

export class ChinaRailway {
  // 使用新的缓存实现
  static ticketCache = new MemoryCache<TicketResponse>(10 * 60 * 1000);
  static trainStationCache = new MemoryCache<TrainStationPanl>(60 * 60 * 1000);

  static stationName: Record<string, string>;
  static stationCode: Record<string, string>;

  // 重试配置
  static retryConfig: RetryConfig = {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2,
  };

  // 缓存 TTL 配置 (毫秒)
  static TICKET_CACHE_TTL = 5 * 60 * 1000;
  static STATION_CACHE_TTL = 4 * 24 * 60 * 60 * 1000; // 站点信息缓存更久

  static clearTicketCache(): void {
    this.ticketCache.clear();
    console.log("已清空所有票务缓存");
  }

  // 通用重试方法
  static async fetchWithRetry(
    url: string,
    options: RequestInit = {},
    retries: number = this.retryConfig.maxRetries
  ): Promise<Response> {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      if (retries > 0) {
        const delay =
          this.retryConfig.retryDelay *
          Math.pow(
            this.retryConfig.backoffMultiplier,
            this.retryConfig.maxRetries - retries
          );
        console.warn(
          `请求失败，${delay}ms后重试 (剩余重试次数: ${retries}):`,
          (error as Error).message
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.fetchWithRetry(url, options, retries - 1);
      }
      throw new Error(`网络请求失败: ${(error as Error).message}`);
    }
  }

  static async getStationName(code: string): Promise<string | undefined> {
    if (!this.stationName) {
      await this.getStationData();
    }
    return this.stationName[code];
  }

  static async getStationCode(name: string): Promise<string | undefined> {
    if (!this.stationCode) {
      await this.getStationData();
    }
    return this.stationCode[name];
  }

  static async getStationData(): Promise<void> {
    let response = await this.fetchWithRetry(
      "https://kyfw.12306.cn/otn/resources/js/framework/station_name.js"
    );
    let stationList = (await response.text())
      .match(/(?<=').+(?=')/)?.[0]
      .split("@")
      .slice(1) || [];

    this.stationCode = {};
    this.stationName = {};
    stationList.forEach((station) => {
      let details = station.split("|");
      this.stationCode[details[1]] = details[2];
      this.stationName[details[2]] = details[1];
    });
  }

  static async checkTickets(date: string, from: string, to: string, delay?: Promise<void>): Promise<TicketResponse> {
    if (
      moment().isSameOrAfter(moment(date, "YYYYMMDD").add(1, "days")) ||
      moment().add(15, "days").isBefore(moment(date, "YYYYMMDD"))
    ) {
      throw new Error("日期需为0~15天内");
    }

    const cacheKey = `${date}_${from}_${to}`;
    const cachedData = this.ticketCache.get(cacheKey);
    if (cachedData) {
      console.log(`使用缓存数据: ${cacheKey}`);
      return cachedData;
    }

    if (delay) {
      await delay;
    }

    let api =
      "https://kyfw.12306.cn/otn/leftTicket/queryG?leftTicketDTO.train_date=" +
      moment(date, "YYYYMMDD").format("YYYY-MM-DD") +
      "&leftTicketDTO.from_station=" +
      from +
      "&leftTicketDTO.to_station=" +
      to +
      "&purpose_codes=ADULT";

    let res = await this.fetchWithRetry(api, {
      headers: {
        Cookie: "JSESSIONID=",
      },
    });

    let data: TicketResponse = await res.json();
    if (!data || !data.status) {
      throw new Error("获取余票数据失败");
    }

    // 缓存数据
    this.ticketCache.set(cacheKey, data, this.TICKET_CACHE_TTL);
    console.log(`缓存新数据: ${cacheKey}`);

    return data;
  }

  static async getTrainAllStations(code: string, from: string, to: string, date: string, delay?: Promise<void>): Promise<TrainStationPanl | undefined> {
    const cacheKey = code; // 车次号作为缓存key
    const cached = this.trainStationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    if (delay) {
      await delay
    }

    let api = "https://kyfw.12306.cn/otn/czxx/queryByTrainNo?"
      + "train_no=" + code
      + "&from_station_telecode=" + from
      + "&to_station_telecode=" + to
      + "&depart_date=" + date;

    try {
        let res = await this.fetchWithRetry(api, {
        headers: {
            Cookie: "JSESSIONID=",
        },
        });

        let resp: TrainStationResponse = await res.json();
        if (resp.data && resp.data.data && resp.data.data.length > 0) {
            await Promise.all(resp.data.data.map(async (item) => {
                item.station_code = await ChinaRailway.getStationCode(item.station_name || '') || "";
            }))

            // 缓存站点信息，过期时间设长一点，或者使用永久缓存（直到重启）
            this.trainStationCache.set(cacheKey, resp.data, this.STATION_CACHE_TTL);
            return resp.data;
        }
    } catch(e) {
        console.warn(`查询车次 ${code} 经停站失败`, e);
    }
    return undefined;
  }

  static parseTrainInfo(str: string): TrainInfo {
    // Ref: https://kyfw.12306.cn/otn/resources/merged/queryLeftTicket_end_js.js
    let arr = str.split("|");
    let data: TrainInfo = {
      secretStr: arr[0],
      buttonTextInfo: arr[1],
      train_no: arr[2],
      station_train_code: arr[3],
      start_station_telecode: arr[4],
      end_station_telecode: arr[5],
      from_station_telecode: arr[6],
      to_station_telecode: arr[7],
      start_time: arr[8],
      arrive_time: arr[9],
      lishi: arr[10],
      canWebBuy: arr[11],
      yp_info: arr[12],
      start_train_date: arr[13],
      train_seat_feature: arr[14],
      location_code: arr[15],
      from_station_no: arr[16],
      to_station_no: arr[17],
      is_support_card: arr[18],
      controlled_train_flag: arr[19],
      gg_num: arr[20],
      gr_num: arr[21],
      qt_num: arr[22],
      rw_num: arr[23],
      rz_num: arr[24],
      tz_num: arr[25],
      wz_num: arr[26],
      yb_num: arr[27],
      yw_num: arr[28],
      yz_num: arr[29],
      ze_num: arr[30],
      zy_num: arr[31],
      swz_num: arr[32],
      srrb_num: arr[33],
      yp_ex: arr[34],
      seat_types: arr[35],
      exchange_train_flag: arr[36],
      houbu_train_flag: arr[37],
      houbu_seat_limit: arr[38],
      yp_info_new: arr[39],
      dw_flag: arr[46],
      stopcheckTime: arr[48],
      country_flag: arr[49],
      local_arrive_time: arr[50],
      local_start_time: arr[51],
      bed_level_info: arr[53],
      seat_discount_info: arr[54],
      sale_time: arr[55],
      tickets: {
        优选一等座: arr[20],
        高级软卧: arr[21],
        其他: arr[22],
        软卧: arr[23],
        软座: arr[24],
        特等座: arr[25],
        无座: arr[26],
        YB: arr[27],
        硬卧: arr[28],
        硬座: arr[29],
        二等座: arr[30],
        一等座: arr[31],
        商务座: arr[32],
        SRRB: arr[33],
      },
    };
    return data;
  }
}

export default ChinaRailway;
