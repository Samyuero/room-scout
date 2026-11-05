import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { AppColors } from '@/constants/theme';
import { getDemandPrediction, getPriceBand } from '@/lib/dorm-discovery';
import type { Dorm, UserCoordinates } from '@/types/dorm';

export type AnalyticsMode = 'price' | 'demand' | 'none';

interface Props {
  dorms: Dorm[];
  center: UserCoordinates;
  radiusKm: number;
  userLocation: UserCoordinates | null;
  analyticsMode?: AnalyticsMode;
  showAnalytics?: boolean; // backwards compatibility
  onSelectDorm?: (dormId: string) => void;
  pickerLocation?: UserCoordinates;
  onPickLocation?: (location: UserCoordinates) => void;
  demandPredictions?: Record<string, { level: 'high' | 'moderate' | 'low'; reason: string }>;
}

const EMPTY_DEMAND_PREDICTIONS: NonNullable<Props['demandPredictions']> = {};

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

function markerColor(status: string) {
  if (status === 'reserved') return '#FBBF24';
  if (status === 'available') return '#34D399';
  return '#F87171';
}

export function LeafletMapView({
  dorms,
  center,
  radiusKm,
  userLocation,
  analyticsMode = 'none',
  showAnalytics = false,
  onSelectDorm,
  pickerLocation,
  onPickLocation,
  demandPredictions = EMPTY_DEMAND_PREDICTIONS,
}: Props) {
  const activeMode: AnalyticsMode = analyticsMode !== 'none' ? analyticsMode : (showAnalytics ? 'price' : 'none');

  const html = useMemo(() => {
    const average = dorms.length ? dorms.reduce((total, dorm) => total + dorm.price, 0) / dorms.length : 0;
    const markers = dorms.map((dorm) => {
      const demand = getDemandPrediction(dorm);
      const aiDemand = demandPredictions[dorm.dorm_id];
      const demandLevel = aiDemand?.level || demand.level;
      const demandColor = demandLevel === 'high' ? '#EF4444' : demandLevel === 'moderate' ? '#FBBF24' : '#34D399';
      const demandBadge = demandLevel === 'high' ? 'High Demand' : demandLevel === 'moderate' ? 'Moderate Demand' : 'Steady Availability';
      const status = dorm.availability_status || (dorm.available ? 'available' : 'unavailable');
      return {
        id: dorm.dorm_id,
        name: escapeHtml(dorm.name),
        price: dorm.price,
        lat: dorm.latitude,
        lng: dorm.longitude,
        status,
        availabilityColor: markerColor(status),
        priceBand: getPriceBand(dorm.price, average),
        demandLevel,
        demandBadge,
        demandColor,
        occupancyRate: demand.occupancyRate,
        availableSlots: demand.availableSlots,
      };
    });

    return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
<style>
html,body,#map{width:100%;height:100%;margin:0;background:#111827} *{box-sizing:border-box}
/* Critical Leaflet layout fallback. It keeps tiles in one continuous pane even
   when the external stylesheet is slow on a mobile connection. */
.leaflet-container{overflow:hidden;outline:0;touch-action:none}
.leaflet-pane,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile-container,.leaflet-pane>svg,.leaflet-pane>canvas,.leaflet-image-layer,.leaflet-layer{position:absolute;left:0;top:0}
.leaflet-pane{z-index:400}.leaflet-tile-pane{z-index:200}.leaflet-overlay-pane{z-index:400}.leaflet-shadow-pane{z-index:500}.leaflet-marker-pane{z-index:600}.leaflet-tooltip-pane{z-index:650}.leaflet-popup-pane{z-index:700}
.leaflet-container img,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow{max-width:none!important;max-height:none!important}
.leaflet-tile{visibility:hidden;user-select:none;-webkit-user-drag:none}.leaflet-tile-loaded{visibility:inherit}
.leaflet-top,.leaflet-bottom{position:absolute;z-index:1000;pointer-events:none}.leaflet-top{top:0}.leaflet-right{right:0}.leaflet-bottom{bottom:0}.leaflet-left{left:0}.leaflet-control{position:relative;z-index:800;pointer-events:auto}
.price-pin{border:0!important;background:transparent!important}.price-pin span{position:relative;display:block;min-width:58px;padding:6px 8px;border-radius:16px;color:white;text-align:center;font:700 11px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.35);border:2px solid rgba(255,255,255,.82)}
.price-pin span:after{content:'';position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:9px solid var(--pin-color);filter:drop-shadow(0 2px 1px rgba(0,0,0,.22))}
.demand-badge{background:#1E293B;color:#F8FAFC;border:1px solid #334155;padding:3px 6px;border-radius:12px;font:700 10px system-ui;display:inline-block;margin-bottom:4px}
.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#111827;color:#fff}.leaflet-popup-content{margin:10px 12px;font:600 12px system-ui}.leaflet-control-attribution{font-size:9px!important}
</style></head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>
const center=${safeJson(center)}, markers=${safeJson(markers)}, user=${safeJson(userLocation)}, picker=${safeJson(pickerLocation || null)}, mode=${safeJson(activeMode)};
const map=L.map('map',{zoomControl:false,attributionControl:true,preferCanvas:true,fadeAnimation:false,zoomAnimation:false,markerZoomAnimation:false}).setView([center.latitude,center.longitude],14);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors',updateWhenIdle:true,updateWhenZooming:false,keepBuffer:2,detectRetina:false}).addTo(map);
L.control.zoom({position:'bottomright'}).addTo(map);

if(user){
  L.circle([user.latitude,user.longitude],{radius:${radiusKm * 1000},color:'#3B82F6',weight:1,fillColor:'#3B82F6',fillOpacity:.05}).addTo(map);
  L.circleMarker([user.latitude,user.longitude],{radius:9,color:'#fff',weight:3,fillColor:'#2563EB',fillOpacity:1}).bindTooltip('Your current position',{permanent:false,direction:'top'}).addTo(map);
}

markers.forEach(function(item){
  if(mode === 'price'){
    const colors={cheaper:'#22C55E',average:'#FBBF24',expensive:'#EF4444'};
    const heatColor=colors[item.priceBand];
    L.circle([item.lat,item.lng],{radius:520,color:heatColor,weight:0,fillColor:heatColor,fillOpacity:.10,interactive:false}).addTo(map);
    L.circle([item.lat,item.lng],{radius:240,color:heatColor,weight:1,fillColor:heatColor,fillOpacity:.28,interactive:false}).addTo(map);
  } else if(mode === 'demand'){
    const fillOp = item.demandLevel === 'high' ? .45 : (item.demandLevel === 'moderate' ? .28 : .12);
    const radius = item.demandLevel === 'high' ? 480 : 320;
    L.circle([item.lat,item.lng],{radius:radius,color:item.demandColor,weight:item.demandLevel === 'high' ? 2 : 1,fillColor:item.demandColor,fillOpacity:fillOp}).addTo(map);
  }

  const demandLabels={high:'High',moderate:'Moderate',low:'Steady'};
  const pinLabel = mode === 'demand' ? demandLabels[item.demandLevel] : '₱'+Math.round(item.price).toLocaleString();
  const pinColor = mode === 'demand' ? item.demandColor : item.availabilityColor;

  const icon=L.divIcon({className:'price-pin',html:'<span style="background:'+pinColor+';--pin-color:'+pinColor+'">'+pinLabel+'</span>',iconSize:[74,39],iconAnchor:[37,39],popupAnchor:[0,-34]});
  
  const popupHtml = mode === 'demand'
    ? '<div class="demand-badge" style="border-color:'+item.demandColor+'">'+item.demandBadge+'</div><br><b>'+item.name+'</b><br>Occupancy: '+item.occupancyRate+'% ('+item.availableSlots+' slots left)<br><small>Tap for details</small>'
    : '<b>'+item.name+'</b><br>₱'+Math.round(item.price).toLocaleString()+'/mo<br><small>Tap pin for details</small>';

  L.marker([item.lat,item.lng],{icon:icon}).addTo(map).bindPopup(popupHtml).on('click',function(){window.ReactNativeWebView.postMessage(JSON.stringify({type:'selectDorm',dormId:item.id}))});
});

if(!picker){
  const points=markers.map(function(item){return [item.lat,item.lng]});
  if(user) points.push([user.latitude,user.longitude]);
  if(points.length > 1) map.fitBounds(L.latLngBounds(points),{padding:[34,34],maxZoom:16});
  else if(points.length === 1) map.setView(points[0],16);
}

if(picker){
  const hint = L.control({position:'topleft'});
  hint.onAdd=function(){const element=L.DomUtil.create('div');element.textContent='Drag the pin or tap map to set location';element.style.cssText='color:#111827;font:600 12px/18px system-ui;margin:0 40px 0 0;text-shadow:0 1px 2px white,0 -1px 2px white;pointer-events:none';return element;};
  hint.addTo(map);
  const pickerIcon = L.divIcon({
    className: '',
    html: '<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg"><path d="M15 40C12 35 2 24 2 15a13 13 0 0 1 26 0c0 9-10 20-13 25Z" fill="#2563eb" stroke="white" stroke-width="2"/><circle cx="15" cy="15" r="4" fill="white"/></svg>',
    iconSize: [30, 42],
    iconAnchor: [15, 42]
  });
  const pickerMarker=L.marker([picker.latitude,picker.longitude],{draggable:true,icon:pickerIcon}).addTo(map);
  
  function sendLocation(lat,lng){
    pickerMarker.setLatLng([lat,lng]);
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'pickLocation',latitude:lat,longitude:lng}));
  }
  map.on('click',function(event){sendLocation(event.latlng.lat,event.latlng.lng)});
  pickerMarker.on('dragend',function(){const point=pickerMarker.getLatLng();sendLocation(point.lat,point.lng)});
  map.setView([picker.latitude,picker.longitude],16);
}

requestAnimationFrame(function(){map.invalidateSize({pan:false,animate:false})});
window.addEventListener('resize',function(){map.invalidateSize({pan:false,animate:false})});

</script></body></html>`;
  }, [activeMode, center, demandPredictions, dorms, pickerLocation, radiusKm, userLocation]);

  const webSource = useMemo(() => ({ html, baseUrl: 'https://rooms.local/' }), [html]);

  function allowRequest(request: WebViewNavigation) {
    return (
      request.url === 'about:blank' ||
      request.url.startsWith('data:text/html') ||
      request.url.startsWith('https://unpkg.com/') ||
      request.url.includes('tile.openstreetmap.org')
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        source={webSource}
        originWhitelist={['about:blank', 'https://*']}
        onShouldStartLoadWithRequest={allowRequest}
        javaScriptEnabled
        domStorageEnabled={false}
        cacheEnabled
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
        androidLayerType="hardware"
        overScrollMode="never"
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        onMessage={(event) => {
          try {
            const message = JSON.parse(event.nativeEvent.data) as {
              type?: string;
              dormId?: string;
              latitude?: number;
              longitude?: number;
            };
            if (message.type === 'selectDorm' && message.dormId) onSelectDorm?.(message.dormId);
            if (
              message.type === 'pickLocation' &&
              typeof message.latitude === 'number' &&
              typeof message.longitude === 'number'
            ) {
              onPickLocation?.({ latitude: message.latitude, longitude: message.longitude });
            }
          } catch {
            // Ignore malformed messages from the isolated map document.
          }
        }}
        style={styles.map}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden', backgroundColor: AppColors.surface },
  map: { flex: 1, backgroundColor: AppColors.surface },
});
