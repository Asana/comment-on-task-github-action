import axios from "axios";
import axiosRetry from "axios-retry";
import { getInput } from "@actions/core";
import { ASANA_SECRET } from "../constants/inputs";
import * as REQUESTS from "../constants/requests";

const asanaAxios = axios.create({
  baseURL: REQUESTS.ASANA_URL,
  headers: {
    Authorization: `Bearer ${getInput(ASANA_SECRET)}`,
  },
});

axiosRetry(asanaAxios, {
  retries: REQUESTS.RETRIES,
  retryDelay: (retryCount) => retryCount * REQUESTS.RETRY_DELAY,
  retryCondition: (error) => {
    const status = error?.response?.status;
    if (!status) return true;
    return String(status).startsWith("50");
  },
});

export default asanaAxios;
