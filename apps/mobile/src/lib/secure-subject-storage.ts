import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { SubjectStorage } from "./guest-subject";

const webStorage: SubjectStorage = {
  async getItem(key) {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  },
  async setItem(key, value) {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  },
  async removeItem(key) {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  },
};

const nativeStorage: SubjectStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export const subjectStorage = Platform.OS === "web" ? webStorage : nativeStorage;
