'use client';
import {create} from 'zustand';import {persist} from 'zustand/middleware';import {emptyPreferences,readPreferences,type Preferences} from '../lib/preferences';
export const usePreferences=create<{data:Preferences;replace:(data:Preferences)=>void}>()(persist(set=>({data:emptyPreferences(),replace:data=>set({data:readPreferences(data)})}),{name:'openterminal-preferences',version:1,partialize:s=>({data:s.data}),merge:(saved,current)=>{try{return {...current,data:readPreferences((saved as {data:unknown}).data)};}catch{return current;}}}));
