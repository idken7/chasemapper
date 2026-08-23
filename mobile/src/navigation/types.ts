import type { NavigatorScreenParams } from '@react-navigation/native';

export type TrackStackParamList = {
  Track: undefined;
};

export type RouteStackParamList = {
  Route: undefined;
};

export type AprsStackParamList = {
  AprsList: undefined;
  CallsignDetail: { callsign: string };
};

export type LogStackParamList = {
  Log: undefined;
};

export type SettingsStackParamList = {
  Settings: undefined;
};

export type BottomTabParamList = {
  TrackTab: NavigatorScreenParams<TrackStackParamList>;
  RouteTab: NavigatorScreenParams<RouteStackParamList>;
  AprsTab: NavigatorScreenParams<AprsStackParamList>;
  LogTab: NavigatorScreenParams<LogStackParamList>;
  SettingsTab: NavigatorScreenParams<SettingsStackParamList>;
};

export type TabKey = keyof BottomTabParamList;
