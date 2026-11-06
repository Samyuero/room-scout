import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { AppColors } from '@/constants/theme';
import { demandLabel, distanceBand, MAP_COLORS, type DemandArea, type MapBounds, type PriceArea } from '@/lib/map-analytics';
import type { Dorm, UserCoordinates } from '@/types/dorm';
import type { RoadRoute } from '@/lib/directions';

export type AnalyticsMode = 'price' | 'demand' | 'none';
interface Props {
  dorms: Dorm[];
  center: UserCoordinates;
  radiusKm: number;
  userLocation: UserCoordinates | null;
  anchor?: UserCoordinates & { label: string; kind?: string };
  analyticsMode?: AnalyticsMode;
  showAnalytics?: boolean;
  onSelectDorm?: (dormId: string) => void;
  pickerLocation?: UserCoordinates;
  onPickLocation?: (location: UserCoordinates) => void;
  demandPredictions?: Record<string, { level: 'high' | 'moderate' | 'low'; reason: string; color?: string; badge?: string }>;
  priceAreas?: PriceArea[];
  demandAreas?: DemandArea[];
  onViewportChange?: (bounds: MapBounds) => void;
  focusKey?: string;
  fitAllDorms?: boolean;
  topPadding?: number;
  roadRoute?: RoadRoute | null;
  routeBottomPadding?: number;
}
const EMPTY_PREDICTIONS: NonNullable<Props['demandPredictions']> = {};
const EMPTY_AREAS: PriceArea[] = [];
const EMPTY_DEMAND_AREAS: DemandArea[] = [];
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

// This document is mounted once. Data is sent to it without reloading the WebView/OSM tile layer.
// In particular, selecting a pin or updating viewport price statistics must not reset the map.
const MAP_HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
<style>
html,body,#map{width:100%;height:100%;margin:0;background:#111827}*{box-sizing:border-box}
/* Keep all tile panes positioned even when the CDN stylesheet arrives late. */
.leaflet-container{overflow:hidden;outline:0;touch-action:none}.leaflet-pane,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile-container,.leaflet-pane>svg,.leaflet-pane>canvas,.leaflet-image-layer,.leaflet-layer{position:absolute;left:0;top:0}
.leaflet-pane{z-index:400}.leaflet-tile-pane{z-index:200}.leaflet-overlay-pane{z-index:400}.leaflet-shadow-pane{z-index:500}.leaflet-marker-pane{z-index:600}.leaflet-tooltip-pane{z-index:650}.leaflet-popup-pane{z-index:700}
.leaflet-container img,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow{max-width:none!important;max-height:none!important}.leaflet-tile{visibility:hidden;user-select:none;-webkit-user-drag:none}.leaflet-tile-loaded{visibility:inherit}
.leaflet-top,.leaflet-bottom{position:absolute;z-index:1000;pointer-events:none}.leaflet-top{top:0}.leaflet-right{right:0}.leaflet-bottom{bottom:0}.leaflet-left{left:0}.leaflet-control{position:relative;z-index:800;pointer-events:auto}
.price-pin{border:0!important;background:transparent!important}.price-pin span{position:relative;display:block;padding:6px 8px;border-radius:16px;color:white;text-align:center;font:700 11px system-ui;box-shadow:0 2px 8px #0006;border:2px solid #fffd;white-space:nowrap}
.price-pin span:after{content:'';position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid var(--pin-color);filter:drop-shadow(0 2px 1px #0004)}
.leaflet-tooltip{font:600 11px system-ui}.leaflet-control-attribution{font-size:9px!important}.leaflet-control-zoom{margin-bottom:24px!important}
</style></head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>
(function(){
  function post(data){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(data))}
  if(!window.L){post({type:'mapError'});return;}
  const map=L.map('map',{zoomControl:false,preferCanvas:true,fadeAnimation:false,zoomAnimation:false,markerZoomAnimation:false}).setView([10.32644,123.95476],15);
  const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors',updateWhenIdle:true,updateWhenZooming:false,keepBuffer:2,detectRetina:false}).addTo(map);
  L.control.zoom({position:'bottomright'}).addTo(map);
  const listingLayer=L.layerGroup().addTo(map), areaLayer=L.layerGroup().addTo(map), originLayer=L.layerGroup().addTo(map), routeLayer=L.layerGroup().addTo(map);
  let lastRouteFocus='';
  let lastFocus='', pickerMarker=null, pickerHint=null, latest=null;
  const pinSvg='<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg"><path d="M15 40C12 35 2 24 2 15a13 13 0 0 1 26 0c0 9-10 20-13 25Z" fill="#2563eb" stroke="white" stroke-width="2"/><circle cx="15" cy="15" r="4" fill="white"/></svg>';
  const pinIcon=L.divIcon({className:'',html:pinSvg,iconSize:[30,42],iconAnchor:[15,42]});
  function plainText(value){const node=document.createElement('span');node.textContent=value;return node;}
  function viewport(){const b=map.getBounds();post({type:'viewport',bounds:{south:b.getSouth(),west:b.getWest(),north:b.getNorth(),east:b.getEast()}})}
  map.on('moveend zoomend',viewport);
  map.on('click',function(event){if(!latest||!latest.picker)return;pickerMarker.setLatLng(event.latlng);post({type:'pickLocation',latitude:event.latlng.lat,longitude:event.latlng.lng})});
  window.updateRoomScoutMap=function(data){
    latest=data;listingLayer.clearLayers();areaLayer.clearLayers();originLayer.clearLayers();routeLayer.clearLayers();
    if(data.anchor){
      L.circle([data.anchor.latitude,data.anchor.longitude],{radius:data.radiusKm*1000,color:'#3B82F6',weight:1,fillColor:'#3B82F6',fillOpacity:.04,interactive:false}).addTo(originLayer);
      if(data.anchor.kind!=='device')L.marker([data.anchor.latitude,data.anchor.longitude],{icon:pinIcon}).bindTooltip(plainText(data.anchor.label),{direction:'top'}).addTo(originLayer);
    }
    if(data.user){
      L.circleMarker([data.user.latitude,data.user.longitude],{radius:7,color:'#fff',weight:2,fillColor:'#2563EB',fillOpacity:1}).bindTooltip('Device location',{direction:'top'}).addTo(originLayer);
      if(data.user.accuracy_m)L.circle([data.user.latitude,data.user.longitude],{radius:Math.min(data.user.accuracy_m,3000),weight:0,fillColor:'#2563EB',fillOpacity:.08,interactive:false}).addTo(originLayer);
    }
    if(data.mode==='price')data.areas.forEach(function(area){
      const color=data.colors[area.band];
      L.circle([area.center.latitude,area.center.longitude],{radius:area.radiusMeters,color:color,weight:1,fillColor:color,fillOpacity:.23}).bindTooltip('Area average: ₱'+Math.round(area.average).toLocaleString()+' / month · '+area.count+' listing'+(area.count===1?'':'s')).addTo(areaLayer);
    });
    if(data.mode==='demand')data.demandAreas.forEach(function(area){
      const color=data.colors[area.level];
      L.circle([area.center.latitude,area.center.longitude],{radius:area.radiusMeters,color:color,weight:1,fillColor:color,fillOpacity:.23})
        .bindTooltip(plainText('Area average: '+area.label+' · '+area.score.toFixed(1)+' / 3 · '+area.count+' dorm'+(area.count===1?'':'s')+' · '+area.radiusMeters+' m radius')).on('click',function(){this.openTooltip()}).addTo(areaLayer);
    });
    data.markers.forEach(function(item){
      const icon=L.divIcon({className:'price-pin',html:'<span style="background:'+item.color+';--pin-color:'+item.color+'">'+item.label+'</span>',iconSize:[76,39],iconAnchor:[38,39]});
      const marker=L.marker([item.lat,item.lng],{icon:icon}).addTo(listingLayer);
      marker.on('click',function(){post({type:'selectDorm',dormId:item.id})});
    });
    if(data.picker){
      if(!pickerHint){pickerHint=L.control({position:'topleft'});pickerHint.onAdd=function(){const el=L.DomUtil.create('div');el.textContent='Drag the pin or tap map to set location';el.style.cssText='color:#111827;font:600 12px/18px system-ui;margin:0 32px 0 0;text-shadow:0 1px 2px white,0 -1px 2px white;pointer-events:none';return el};pickerHint.addTo(map)}
      if(!pickerMarker){pickerMarker=L.marker([data.picker.latitude,data.picker.longitude],{draggable:true,icon:pinIcon}).addTo(map);pickerMarker.on('dragend',function(){const p=pickerMarker.getLatLng();post({type:'pickLocation',latitude:p.lat,longitude:p.lng})})}
      else pickerMarker.setLatLng([data.picker.latitude,data.picker.longitude]);
    }
    const focus=data.focusKey || data.center.latitude+','+data.center.longitude;
    if(focus!==lastFocus){
      lastFocus=focus;
      const exactDorm=String(data.focusKey||'').indexOf('dorm:')===0;
      map.setView([data.center.latitude,data.center.longitude],exactDorm?17:data.picker||data.markers.length===1&&!data.anchor?16:15,{animate:false});
      // The school is the anchor; far-away listings remain reachable without pulling the user away from it.
      if(data.anchor&&!data.picker&&!exactDorm)map.fitBounds(L.latLng(data.anchor.latitude,data.anchor.longitude).toBounds(data.radiusKm*2000),{paddingTopLeft:[28,160],paddingBottomRight:[28,70],maxZoom:16,animate:false});
      if(data.fitAllDorms&&!data.picker&&!exactDorm&&data.markers.length){
        const points=data.markers.map(function(item){return [item.lat,item.lng]});
        if(data.anchor){const radiusBounds=L.latLng(data.anchor.latitude,data.anchor.longitude).toBounds(data.radiusKm*2000);points.push(radiusBounds.getSouthWest(),radiusBounds.getNorthEast())}
        const topPadding=Math.min(data.topPadding||240,Math.max(80,map.getSize().y-160));
        map.fitBounds(L.latLngBounds(points),{paddingTopLeft:[24,topPadding],paddingBottomRight:[24,80],maxZoom:data.markers.length===1&&!data.anchor?16:15,animate:false});
      }
    }
    if(data.roadRoute){
      const route=data.roadRoute, points=route.coordinates;
      L.polyline(points,{color:'#fff',weight:9,opacity:.9,interactive:false}).addTo(routeLayer);
      L.polyline(points,{color:'#2563EB',weight:5,opacity:1,interactive:false}).addTo(routeLayer);
      const start=[route.start.latitude,route.start.longitude], end=[route.end.latitude,route.end.longitude];
      L.polyline([start,points[0]],{color:'#2563EB',weight:2,dashArray:'5 5',interactive:false}).addTo(routeLayer);
      L.polyline([points[points.length-1],end],{color:'#2563EB',weight:2,dashArray:'5 5',interactive:false}).addTo(routeLayer);
      L.circleMarker(start,{radius:7,color:'#fff',weight:2,fillColor:'#2563EB',fillOpacity:1}).bindTooltip('Route start').addTo(routeLayer);
      L.circleMarker(end,{radius:7,color:'#fff',weight:2,fillColor:'#10B981',fillOpacity:1}).bindTooltip('Destination').addTo(routeLayer);
      const routeFocus=JSON.stringify([start,end,data.topPadding,data.routeBottomPadding]);
      if(routeFocus!==lastRouteFocus){lastRouteFocus=routeFocus;const h=map.getSize().y;const top=Math.min(data.topPadding||160,Math.max(80,h-160));const bottom=Math.min(data.routeBottomPadding||220,Math.max(60,h-top-60));map.fitBounds(L.latLngBounds(points.concat([start,end])),{paddingTopLeft:[28,top],paddingBottomRight:[28,bottom],maxZoom:17,animate:false})}
    }else lastRouteFocus='';
    map.invalidateSize({pan:false,animate:false});
    viewport();
  };
  window.addEventListener('resize',function(){map.invalidateSize({pan:false,animate:false})});
  requestAnimationFrame(function(){map.invalidateSize({pan:false,animate:false});post({type:'ready'})});
})();
</script></body></html>`;

export function LeafletMapView({ dorms, center, radiusKm, userLocation, anchor, analyticsMode = 'none', showAnalytics = false, onSelectDorm, pickerLocation, onPickLocation, demandPredictions = EMPTY_PREDICTIONS, priceAreas = EMPTY_AREAS, demandAreas = EMPTY_DEMAND_AREAS, onViewportChange, focusKey, fitAllDorms = false, topPadding = 160, roadRoute = null, routeBottomPadding = 220 }: Props) {
  const webView = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setMapError(true),15000);
    return () => clearTimeout(timer);
  },[ready,attempt]);
  const activeMode = analyticsMode !== 'none' ? analyticsMode : showAnalytics ? 'price' : 'none';
  const payload = useMemo(() => ({
    center, anchor, radiusKm, user: userLocation, picker: pickerLocation, mode: activeMode, focusKey, fitAllDorms, topPadding,
    areas: priceAreas, demandAreas, colors: MAP_COLORS, roadRoute, routeBottomPadding,
    markers: dorms.map((dorm) => {
      const demand = demandPredictions[dorm.dorm_id];
      const color = activeMode === 'demand' ? demand?.color || (demand ? MAP_COLORS[demand.level] : MAP_COLORS.insufficient)
        : anchor ? MAP_COLORS[distanceBand(dorm, anchor, radiusKm)]
        : dorm.availability_status === 'available' ? AppColors.success : dorm.availability_status === 'reserved' ? AppColors.warning : AppColors.error;
      return { id: dorm.dorm_id, name: dorm.name.replace(/[<>]/g, ''), lat: dorm.latitude, lng: dorm.longitude,
        color, label: activeMode === 'demand' ? demand ? demandLabel(demand.level) : '…' : `₱${Math.round(dorm.price).toLocaleString('en-PH')}` };
    }),
  }), [center, anchor, radiusKm, userLocation, pickerLocation, activeMode, focusKey, fitAllDorms, topPadding, priceAreas, demandAreas, dorms, demandPredictions, roadRoute, routeBottomPadding]);
  const serialized = safeJson(payload);
  useEffect(() => {
    if (ready) webView.current?.injectJavaScript(`window.updateRoomScoutMap&&window.updateRoomScoutMap(${serialized});true;`);
  }, [ready, serialized]);

  function allowRequest(request: WebViewNavigation) {
    return request.url === 'about:blank' || request.url.startsWith('data:text/html') || request.url.startsWith('https://rooms.local/') || request.url.startsWith('https://unpkg.com/') || request.url.startsWith('https://tile.openstreetmap.org/');
  }
  return <View style={styles.container}><WebView key={attempt} ref={webView} source={MAP_SOURCE} originWhitelist={['about:blank', 'https://*']} onShouldStartLoadWithRequest={allowRequest}
    javaScriptEnabled domStorageEnabled={false} cacheEnabled cacheMode="LOAD_CACHE_ELSE_NETWORK" androidLayerType="hardware" overScrollMode="never" mixedContentMode="never" setSupportMultipleWindows={false}
    onMessage={(event) => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
        if (message.type === 'ready') { setReady(true); setMapError(false); }
        if (message.type === 'mapError') setMapError(true);
        if (message.type === 'selectDorm' && typeof message.dormId === 'string' && dorms.some((dorm) => dorm.dorm_id === message.dormId)) onSelectDorm?.(message.dormId);
        if (message.type === 'pickLocation' && Number.isFinite(message.latitude) && Number.isFinite(message.longitude) && Math.abs(message.latitude) <= 90 && Math.abs(message.longitude) <= 180) onPickLocation?.({ latitude: message.latitude, longitude: message.longitude });
        if (message.type === 'viewport' && message.bounds && ['south', 'west', 'north', 'east'].every((key) => Number.isFinite(message.bounds[key]))) onViewportChange?.(message.bounds);
      } catch { /* Ignore malformed isolated-map messages. */ }
    }} onError={() => setMapError(true)} style={styles.map} />{mapError && <View style={styles.errorOverlay}><Text style={styles.errorText}>Map could not load. Check your internet connection and retry.</Text><Pressable accessibilityRole="button" style={styles.retry} onPress={() => { setMapError(false); setReady(false); setAttempt((value) => value+1); }}><Text style={styles.retryText}>Retry map</Text></Pressable></View>}</View>;
}
const MAP_SOURCE = { html: MAP_HTML, baseUrl: 'https://rooms.local/' };
const styles = StyleSheet.create({ container: { flex: 1, overflow: 'hidden', backgroundColor: AppColors.surface }, map: { flex: 1, backgroundColor: AppColors.surface }, errorOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, padding: 24, gap: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: AppColors.overlay }, errorText: { color: AppColors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' }, retry: { backgroundColor: AppColors.accent, padding: 14, borderRadius: 10, minHeight: 48 }, retryText: { color: AppColors.white, fontWeight: '600' } });
