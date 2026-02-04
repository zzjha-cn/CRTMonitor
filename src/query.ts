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
    constructor(private notificationManager: NotificationManager) { }

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

    async searchTickets(search: SearchConfig, collector: Map<string, string[]>, date: string): Promise<void> {
        log.info(`查询 ${date} ${search.from}→${search.to} 车票：`);
        let fromCode = (await ChinaRailway.getStationCode(search.from)) || "";
        let toCode = (await ChinaRailway.getStationCode(search.to)) || "";
        let data: TicketResponse;
        try {
            data = await ChinaRailway.checkTickets(
                date,
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

            let arriveHour = parseInt(item.arrive_time.slice(0, 2));
            // 尝试利用历时计算准确的跨天到达时间（例如次日02:00会被计算为26:00）
            const [lishiH, lishiM] = item.lishi.split(':').map(Number);
            const startHour = parseInt(item.start_time.slice(0, 2));

            if (!isNaN(lishiH) && !isNaN(startHour)) {
                const startM = parseInt(item.start_time.split(':')[1]) || 0;
                const lishiMin = isNaN(lishiM) ? 0 : lishiM;
                arriveHour = Math.floor(((startHour * 60 + startM) + (lishiH * 60 + lishiMin)) / 60);
            } else if (arriveHour < startHour) {
                // 降级：仅处理跨一天的情况
                arriveHour += 24;
            }

            const endTrue = search.trains_filter?.endHour === undefined ||
                arriveHour <= search.trains_filter?.endHour;
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
        /*
            {
              secretStr: "Rskt6Kp%2FskeCVPKzoxQaizjRLVL7ssnwv7Eb5Zdd44G5AkhE8mhva5IF%2FoAbPuP8QDG8e%2Bf75P2O%0AzHooU4BSu0v0MEYNxRaZ9f8IRc3X%2F0AyYc1K5V6wZBKuvi%2BAByXV79laqpL1oPps2EgsXAEV5tz7%0AbLXyRNmx3M75qY4KEer2V1IK0s9e5t9CJDVhPyD%2FuL%2BQtBhCSOfnE4o8Z1BqH4dNb0fmbguc%2FkfB%0Ajuwu2HzG0xApQeEJbljhpVp7YyFxcBsBYHMup%2FjI%2Ba9OsDWde8S0v1nQgSa34KHbP57%2Bb1wpg4Lm%0AfOsTfMLgbqb72SMSiVkAmVSMVkAKtyg57XEr1CdXs4Rz8sYj3tytm3cz8CM%3D",
              buttonTextInfo: "11点起售",
              train_no: "67000G513500",
              station_train_code: "G5135",
              start_station_telecode: "OTQ",
              end_station_telecode: "ZMQ",
              from_station_telecode: "ZCA",
              to_station_telecode: "YBQ",
              start_time: "13:43",
              arrive_time: "16:03",
              lishi: "02:20",
              canWebBuy: "IS_TIME_NOT_BUY",
              yp_info: "B0BPqCZG4nTXUTfrtXznM4WQuqtutojSz9q2eFqV4IgGTDq49vb0a0JsGlY%3D",
              start_train_date: "20260218",
              train_seat_feature: "3",
              location_code: "Q6",
              from_station_no: "05",
              to_station_no: "10",
              is_support_card: "1",
              controlled_train_flag: "0",
              gg_num: "",
              gr_num: "",
              qt_num: "",
              rw_num: "",
              rz_num: "",
              tz_num: "",
              wz_num: "*",
              yb_num: "",
              yw_num: "",
              yz_num: "",
              ze_num: "*",
              zy_num: "*",
              swz_num: "*",
              srrb_num: "",
              yp_ex: "90M0O0W0",
              seat_types: "9MOO",
              exchange_train_flag: "0",
              houbu_train_flag: "1",
              houbu_seat_limit: "",
              yp_info_new: "9057100000M025900000O017100001O017103000",
              dw_flag: "5#1#Q0210#0#z#0#z#z",
              stopcheckTime: "",
              country_flag: "CHN,CHN",
              local_arrive_time: "",
              local_start_time: "",
              bed_level_info: "",
              seat_discount_info: "90080M0083O0084W0084",
              sale_time: "202602041100",
              tickets: {
                    "优选一等座": "",
                    "高级软卧": "",
                    "其他": "",
                    "软卧": "",
                    "软座": "",
                    "特等座": "",
                    "无座": "*",
                YB: "",
                    "硬卧": "",
                    "硬座": "",
                    "二等座": "*",
                    "一等座": "*",
                    "商务座": "*",
                SRRB: "",
                },
            }
        */

        // 检查主线路是否有余票
        for (let trainInfo of parseTrainList) {
            await this.determineRemainTickets(trainInfo, date, collector, search.seatCategory, search.exclude);
        }

        // 冗余终点站查询
        const extendedStations = await this.getExtendedStations(parseTrainList, "destination");
        if (extendedStations.length > 0) {
            const groupedQueries = this.groupQueriesByStation(extendedStations, search, date);
            for (const queries of groupedQueries) {
                await this.processStationQueries(queries, collector);
            }
        }

        // 冗余起点站
        // console.log("冗余起点站");
        const extendedStations2 = await this.getExtendedStations(parseTrainList, "origin");
        if (extendedStations2.length > 0) {
            const groupedQueries2 = this.groupQueriesByStation(extendedStations2, search, date);
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
            const groupedQueries = this.groupQueriesByStation(extendedStationsAll, search, date);
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
        exclude?: { trains?: string[]; to?: string[] },
    ): Promise<void> {
        const fromName = await ChinaRailway.getStationName(trainInfo.from_station_telecode);
        const toName = await ChinaRailway.getStationName(trainInfo.to_station_telecode);

        // 检查排除规则
        if (exclude) {
            // 排除指定车次
            if (exclude.trains && exclude.trains.includes(trainInfo.station_train_code)) {
                return;
            }
            // 排除指定终点站
            if (exclude.to && toName && exclude.to.includes(toName)) {
                return;
            }
        }

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
            // const bookingUrl = `https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc&fs=${encodeURIComponent(fromName || "")},${trainInfo.from_station_telecode}&ts=${encodeURIComponent(toName || "")},${trainInfo.to_station_telecode}&date=${date}&flag=N,N,Y`;
            const bookingUrl = `https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc`;

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

            // *的表示预售
            if (ticketVal != "" && ticketVal != "无" && ticketVal != "--" && ticketVal != "*") {
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
                    sleep(500) // 减少延迟
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

    private groupQueriesByStation(extendedStations: ExtendStationCfg[], search: SearchConfig, date: string): TrainQuerier[][] {
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
                    date: date,
                    seatCategory: search.seatCategory,
                    exclude: search.exclude,
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

            if (!data?.status || !data?.data?.result) return;

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
                await this.determineRemainTickets(trainInfo, info.date, collector, info.seatCategory, info.exclude);
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
