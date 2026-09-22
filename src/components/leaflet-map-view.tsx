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
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
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
}: Props) {
  const activeMode: AnalyticsMode = analyticsMode !== 'none' ? analyticsMode : (showAnalytics ? 'price' : 'none');

  const html = useMemo(() => {
    const average = dorms.length ? dorms.reduce((total, dorm) => total + dorm.price, 0) / dorms.length : 0;
    const markers = dorms.map((dorm) => {
      const demand = getDemandPrediction(dorm);
      const status = dorm.availability_status || (dorm.available ? 'available' : 'unavailable');
      return {
        id: dorm.dorm_id,
        name: dorm.name,
        price: dorm.price,
        lat: dorm.latitude,
        lng: dorm.longitude,
        status,
        color: markerColor(status),
        priceBand: getPriceBand(dorm.price, average),
        demandLevel: demand.level,
        demandBadge: demand.badge,
        demandColor: demand.color,
        occupancyRate: demand.occupancyRate,
        availableSlots: demand.availableSlots,
      };
    });

    return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIINfQ3ynhJb+MZ1ue1lMZz4G+4Yz0YhD0s=" crossorigin="" />
<style>
html,body,#map{width:100%;height:100%;margin:0;background:#111827} *{box-sizing:border-box}
.price-pin{border:0!important;background:transparent!important}.price-pin span{display:block;min-width:54px;padding:6px 8px;border-radius:16px;color:white;text-align:center;font:700 11px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.35);border:2px solid rgba(255,255,255,.82)}
.demand-badge{background:#1E293B;color:#F8FAFC;border:1px solid #334155;padding:3px 6px;border-radius:12px;font:700 10px system-ui;display:inline-block;margin-bottom:4px}
.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#111827;color:#fff}.leaflet-popup-content{margin:10px 12px;font:600 12px system-ui}.leaflet-control-attribution{font-size:9px!important}
</style></head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>
const center=${safeJson(center)}, markers=${safeJson(markers)}, user=${safeJson(userLocation)}, picker=${safeJson(pickerLocation || null)}, mode=${safeJson(activeMode)};
const map=L.map('map',{zoomControl:false,attributionControl:true}).setView([center.latitude,center.longitude],14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
L.control.zoom({position:'bottomright'}).addTo(map);

if(user){
  const zone=L.circle([user.latitude,user.longitude],{radius:${radiusKm * 1000},color:'#3B82F6',weight:1,fillColor:'#3B82F6',fillOpacity:.06}).addTo(map);
  L.circleMarker([user.latitude,user.longitude],{radius:7,color:'#fff',weight:2,fillColor:'#3B82F6',fillOpacity:1}).bindTooltip('You are here').addTo(map);
  map.fitBounds(zone.getBounds(),{padding:[26,26],maxZoom:15})
}

markers.forEach(function(item){
  if(mode === 'price'){
    const colors={cheaper:'#22C55E',average:'#FBBF24',expensive:'#EF4444'};
    L.circle([item.lat,item.lng],{radius:360,color:colors[item.priceBand],weight:1,fillColor:colors[item.priceBand],fillOpacity:.26}).addTo(map);
  } else if(mode === 'demand'){
    const fillOp = item.demandLevel === 'high' ? .45 : (item.demandLevel === 'moderate' ? .28 : .12);
    const radius = item.demandLevel === 'high' ? 480 : 320;
    L.circle([item.lat,item.lng],{radius:radius,color:item.demandColor,weight:item.demandLevel === 'high' ? 2 : 1,fillColor:item.demandColor,fillOpacity:fillOp}).addTo(map);
  }

  const pinLabel = mode === 'demand'
    ? (item.demandLevel === 'high' ? '🔥 High' : '₱'+Math.round(item.price).toLocaleString())
    : '₱'+Math.round(item.price).toLocaleString();

  const icon=L.divIcon({className:'price-pin',html:'<span style="background:'+item.color+'">'+pinLabel+'</span>',iconSize:[66,30],iconAnchor:[33,15]});
  
  const popupHtml = mode === 'demand'
    ? '<div class="demand-badge" style="border-color:'+item.demandColor+'">'+item.demandBadge+'</div><br><b>'+item.name+'</b><br>Occupancy: '+item.occupancyRate+'% ('+item.availableSlots+' slots left)<br><small>Tap for details</small>'
    : '<b>'+item.name+'</b><br>₱'+Math.round(item.price).toLocaleString()+'/mo<br><small>Tap pin for details</small>';

  L.marker([item.lat,item.lng],{icon:icon}).addTo(map).bindPopup(popupHtml).on('click',function(){window.ReactNativeWebView.postMessage(JSON.stringify({type:'selectDorm',dormId:item.id}))});
});

if(picker){
  const pickerIcon = L.divIcon({
    className: 'price-pin',
    html: '<span style="background:#2563EB;border-color:#FFFFFF;box-shadow:0 0 0 4px rgba(37,99,235,0.4);font-weight:900">📍 New Listing Pin</span>',
    iconSize: [130, 32],
    iconAnchor: [65, 16]
  });
  const pickerMarker=L.marker([picker.latitude,picker.longitude],{draggable:true,icon:pickerIcon}).addTo(map).bindTooltip('Drag pin or tap map to set location',{permanent:true,direction:'top'}).openTooltip();
  
  function sendLocation(lat,lng){
    pickerMarker.setLatLng([lat,lng]);
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'pickLocation',latitude:lat,longitude:lng}));
  }
  map.on('click',function(event){sendLocation(event.latlng.lat,event.latlng.lng)});
  pickerMarker.on('dragend',function(){const point=pickerMarker.getLatLng();sendLocation(point.lat,point.lng)});
  map.setView([picker.latitude,picker.longitude],16);
}

</script></body></html>`;
  }, [activeMode, center, dorms, pickerLocation, radiusKm, userLocation]);

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
        source={{ html, baseUrl: 'https://rooms.local/' }}
        originWhitelist={['about:blank', 'https://*']}
        onShouldStartLoadWithRequest={allowRequest}
        javaScriptEnabled
        domStorageEnabled={false}
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

