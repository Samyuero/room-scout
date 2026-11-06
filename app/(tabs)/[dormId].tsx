import { ErrorToast, showError } from '@/components/error-toast';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator, Pressable, Modal, TextInput, ScrollView, Linking, Alert, useWindowDimensions } from 'react-native';
import { PhotoViewer } from '@/components/photo-viewer';
import { BookingDocument } from '@/components/booking-document';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../src/lib/supabase';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';
import * as ImagePicker from 'expo-image-picker';
import { LeafletMapView } from '@/components/leaflet-map-view';
import { useNotifications } from '@/context/notification-context';
import { useDiscovery } from '@/context/discovery-context';
import { getPrivateDocumentUrl, getSafeImageExtension, uploadImage, uploadPrivateImage } from '@/utils/imageUpload';
import { AppColors, BorderRadius } from '@/constants/theme';
import { canCancelRentalRequest, canRequestBookingRefund, rentalCancellationWarning } from '@/lib/rental-workflow';
import { logEvent } from '@/lib/logger';

export default function DormDetails() {
  const { dormId } = useLocalSearchParams<{ dormId: string }>();
  const { user, loading: authLoading } = useAuth();
  const { width, height, fontScale } = useWindowDimensions();
  const compactLayout = width < 390 || fontScale > 1.1;
  const router = useRouter();
  const { compareIds, toggleCompare, refresh: refreshDiscovery } = useDiscovery();
  const { notifications, refreshUnreadCount } = useNotifications();
  const hasRequestActivity = notifications.some((item) => !item.read && item.related_dorm_id === dormId && item.related_request_id);
  const hasTenantActivity = notifications.some((item) => !item.read && item.related_dorm_id === dormId && ['approved', 'rental_accepted', 'rental_ended', 'cancelled'].includes(item.type));
  const [dorm, setDorm] = useState<any | null>(null);
  const isOwner = Boolean(user?.id && dorm?.owner_id === user.id);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<any[]>([]);
  const [newReview, setNewReview] = useState({ rating: 0, comment: '' });
  const [reviewPhotos, setReviewPhotos] = useState<string[]>([]);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [rentalRequestStatus, setRentalRequestStatus] = useState<string | null>(null);
  const [requestDetails, setRequestDetails] = useState<any | null>(null);
  const [requestingRental, setRequestingRental] = useState(false);
  const [rentalModalVisible, setRentalModalVisible] = useState(false);
  const [idDocumentUrl, setIdDocumentUrl] = useState('');
  const [paymentProofUrl, setPaymentProofUrl] = useState('');
  const [extraDetails, setExtraDetails] = useState('');
  const [requestType, setRequestType] = useState<'rental' | 'reservation'>('rental');
  const [photoGallery, setPhotoGallery] = useState<{ photos: string[]; index: number } | null>(null);
  const [requestStep, setRequestStep] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<'qr' | 'cash'>('qr');
  const [contractAgreed, setContractAgreed] = useState(false);
  const [secureQrUrl, setSecureQrUrl] = useState('');

  useEffect(() => {
    setRentalModalVisible(false);
    setRequestDetails(null);
    setRentalRequestStatus(null);
  }, [dormId, user?.id]);

  useEffect(() => {
    let active = true;
    async function loadProtectedPaymentFiles() {
      const qr = await getPrivateDocumentUrl(requestDetails?.owner_payment_qr_url || '');
      if (active) {
        setSecureQrUrl(qr);
      }
    }
    if (requestDetails?.status === 'awaiting_payment') void loadProtectedPaymentFiles();
    else {
      setSecureQrUrl('');
    }
    return () => { active = false; };
  }, [requestDetails]);

  const loadDorm = useCallback(async () => {
    if (!dormId) return;

    setLoading(true);
    try {
      // Get dorm details
      const { data: dormData, error: dormError } = await supabase
        .from('dorms')
        .select('*')
        .eq('dorm_id', dormId)
        .single();

      if (dormError) throw dormError;

      // Check if current user is the owner
      const ownerCheck = user?.id === dormData.owner_id;

      // Get reviews for this dorm
      let { data: reviewsData, error: reviewsError } = await supabase.rpc('get_public_dorm_reviews', { p_dorm_id: dormId });
      if (reviewsError) {
        const fallback = await supabase
          .from('dorm_reviews')
          .select('*, renters(username, avatar_url)')
          .eq('dorm_id', dormId)
          .order('created_at', { ascending: false });
        reviewsData = (fallback.data || []).map((review: any) => ({
          ...review,
          reviewer_name: review.renters?.username ? `@${review.renters.username}` : 'Renter',
          reviewer_avatar_url: review.renters?.avatar_url || null,
        }));
        reviewsError = fallback.error;
      }

      if (reviewsError) throw reviewsError;
      setDorm(dormData);
      setReviews(reviewsData || []);

      if (user && !ownerCheck) {
        const { data: reqData, error: reqError } = await supabase
          .from('rental_requests')
          .select('*')
          .eq('dorm_id', dormId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!reqError && reqData) {
          setRentalRequestStatus(reqData.status);
          setRequestDetails(reqData);
        } else {
          setRentalRequestStatus(null);
          setRequestDetails(null);
        }
      }
    } catch (error) {
      console.error('Error loading dorm details:', error);
    } finally {
      setLoading(false);
    }
  }, [dormId, user]);

  // Refetch data every time the screen gains focus
  useFocusEffect(
    useCallback(() => {
      loadDorm();
    }, [loadDorm])
  );

  const handleToggleAvailability = async () => {
    if (!dorm || !dormId || !isOwner) return;
    if (!dorm.available && Number(dorm.occupied_tenants || 0) >= Number(dorm.max_tenants || 1)) {
      showError('No free slots', 'End a tenancy or release a reservation before reopening this dorm.'); return;
    }
    try {
      const { data, error } = await supabase
        .from('dorms')
        .update({ available: !dorm.available })
        .eq('dorm_id', dormId).select('available,availability_status').single();

      if (error) throw error;

      setDorm((prev: any) => ({
        ...prev,
        ...data,
      }));
      await refreshDiscovery();
    } catch (error) {
      console.error('Error updating availability:', error);
      showError('Availability not updated', error instanceof Error ? error.message : 'Please retry.');
    }
  };

  const handleRequestRental = (type: 'rental' | 'reservation' = 'rental') => {
    if (authLoading) return;
    if (isOwner) {
      showError('Your listing', 'You cannot rent or reserve your own dormitory.');
      return;
    }
    if (!user) {
      Alert.alert('Sign In Required', 'Please sign in to request renting this dormitory.');
      return;
    }
    setRequestType(type);
    setRequestStep(0);
    setRentalModalVisible(true);
  };

  const submitRentalRequest = async () => {
    if (!user || !dorm || requestingRental) return;
    if (isOwner) { showError('Your listing', 'You cannot rent or reserve your own dormitory.'); return; }

    if (!idDocumentUrl.trim()) {
      showError('Government ID required', 'Choose a clear photo of your government ID before submitting.');
      return;
    }

    setRequestingRental(true);
    try {
      const { data: currentDorm, error: ownershipError } = await supabase.from('dorms').select('owner_id').eq('dorm_id', dormId).single();
      if (ownershipError) throw ownershipError;
      if (currentDorm.owner_id === user.id) throw new Error('You cannot rent or reserve your own dormitory.');
      const { error: profileError } = await supabase.from('renters').upsert({ renter_id: user.id, updated_at: new Date().toISOString() }, { onConflict: 'renter_id' });
      if (profileError) throw profileError;
      const idPath = idDocumentUrl.startsWith('file:') || idDocumentUrl.startsWith('content:')
        ? await uploadPrivateImage(`${user.id}/government-id/${Date.now()}.${getSafeImageExtension(idDocumentUrl)}`, idDocumentUrl)
        : idDocumentUrl.trim();
      const { data: currentRequests, error: readError } = await supabase.from('rental_requests').select('request_id').eq('dorm_id', dormId).eq('user_id', user.id).in('status', ['pending', 'awaiting_payment', 'awaiting_cash', 'payment_submitted', 'approved', 'reserved', 'refund_requested', 'refund_sent']).limit(1);
      if (readError) throw readError;
      if (currentRequests?.length) throw new Error('You already have an active request for this dorm.');
      const { error } = await supabase.from('rental_requests').insert({ dorm_id: dormId, user_id: user.id, owner_id: currentDorm.owner_id, status: 'pending', renter_gov_id_url: idPath, message: extraDetails.trim().slice(0, 1000), request_type: requestType, payment_method: paymentMethod });
      if (error) throw error;

      await loadDorm();
      setRentalRequestStatus('pending');
      setRentalModalVisible(false);
      setIdDocumentUrl('');
      setExtraDetails('');
      Alert.alert('Request submitted', `The owner will review your ${requestType} request and ID before sending payment instructions.`);
    } catch (error: any) {
      console.warn('Request submission failed:', error?.code || 'unknown');
      const message = error?.code === '23505' ? 'You already have an open request for this dorm. Refresh the listing to view it.' : String(error?.message || 'Failed to submit rental request.');
      const schemaMissing = /request_type.+schema cache|PGRST204/i.test(message);
      showError(
        schemaMissing ? 'Database update required' : 'Request could not be submitted',
        schemaMissing
          ? 'The rental workflow migration has not been applied to Supabase yet. An administrator must run supabase/roomscout_runtime_update.sql, then try again.'
          : message,
      );
    } finally {
      setRequestingRental(false);
    }
  };

  const submitPaymentProof = async () => {
    if (!user || !requestDetails?.request_id) return;
    if (!contractAgreed || !paymentProofUrl.trim()) {
      showError('Complete the payment step', 'Agree to the contract and choose a payment receipt image.');
      return;
    }

    setRequestingRental(true);
    try {
      const paymentPath = paymentProofUrl.startsWith('file:') || paymentProofUrl.startsWith('content:')
        ? await uploadPrivateImage(`${user.id}/payment-proof/${Date.now()}.${getSafeImageExtension(paymentProofUrl)}`, paymentProofUrl)
        : paymentProofUrl.trim();
      const { error } = await supabase
        .from('rental_requests')
        .update({
          payment_proof_url: paymentPath,
          contract_agreed: true,
          payment_status: 'pending_verification',
          status: 'payment_submitted',
          updated_at: new Date().toISOString(),
        })
        .eq('request_id', requestDetails.request_id)
        .eq('user_id', user.id)
        .eq('status', 'awaiting_payment')
        .select('request_id').single();
      if (error) throw error;

      setRentalRequestStatus('payment_submitted');
      setRequestDetails((current: any) => ({ ...current, status: 'payment_submitted', payment_status: 'pending_verification', payment_proof_url: paymentPath, contract_agreed: true }));
      setRentalModalVisible(false);
      setPaymentProofUrl('');
      setContractAgreed(false);
      Alert.alert('Payment proof submitted', 'Your dorm owner will review and confirm the payment.');
    } catch (error: any) {
      if (error?.code === 'PGRST116') {
        showError('Request changed', 'Refresh this request. Your booking and any payment review are available in Bookings & history.');
        await loadDorm();
      } else showError('Upload failed', error.message || 'Could not submit payment proof.');
    } finally {
      setRequestingRental(false);
    }
  };

  const handleCancelRental = async () => {
    if (!user || !dorm || isOwner || requestingRental) return;
    if (canRequestBookingRefund(requestDetails)) {
      router.push({ pathname: '/booking-history', params: { requestId: requestDetails.request_id } } as never);
      return;
    }
    if (!requestDetails?.request_id || !canCancelRentalRequest(requestDetails)) {
      Alert.alert('Request unavailable', 'Refresh this listing and try again.');
      return;
    }
    Alert.alert(
      'Cancel this request?',
      rentalCancellationWarning,
      [
        { text: 'Keep request', style: 'cancel' },
        {
          text: 'Yes, cancel request',
          style: 'destructive',
          onPress: async () => {
            setRequestingRental(true);
            try {
              const { error: rpcError } = await supabase.rpc('cancel_rental_request', {
                p_request_id: requestDetails.request_id,
              });

              if (rpcError) throw rpcError;

              logEvent('info', 'rental_request_cancelled', { userId: user.id, requestId: requestDetails.request_id, previousStatus: requestDetails.status });
              setRentalRequestStatus('cancelled');
              setRequestDetails((current: any) => current ? { ...current, status: 'cancelled' } : current);
              setRentalModalVisible(false);
              setPaymentProofUrl('');
              setContractAgreed(false);
              const refreshes = await Promise.allSettled([loadDorm(), refreshDiscovery(), refreshUnreadCount()]);
              if (refreshes.some((result) => result.status === 'rejected')) {
                logEvent('warn', 'rental_post_cancel_refresh_failed', { userId: user.id, requestId: requestDetails.request_id });
              }
              Alert.alert('Request cancelled', 'The owner has been notified. Any uploaded receipt will still be reviewed. If payment is confirmed, you can request the 90% refund in Bookings & history.');
            } catch (error: any) {
              logEvent('warn', 'rental_request_cancellation_failed', { userId: user.id, requestId: requestDetails.request_id, code: error?.code || 'network_or_unknown' });
              showError('Error', error.message || 'Failed to cancel rental.');
            } finally {
              setRequestingRental(false);
            }
          }
        }
      ]
    );
  };

  const handleSubmitReview = async () => {
    if (!user) {
      Alert.alert('Sign In Required', 'Please sign in before leaving a review.');
      return;
    }

    if (isOwner) {
      Alert.alert('Owner review unavailable', 'You cannot review your own listing.');
      return;
    }

    if (newReview.rating < 1 || newReview.rating > 5) {
      Alert.alert('Choose a rating', 'Tap a star before submitting your review.');
      return;
    }

    setSubmittingReview(true);
    try {
      const { data: savedProfile } = await supabase
        .from('renters')
        .select('username, full_name, avatar_url')
        .eq('renter_id', user.id)
        .maybeSingle();
      const reviewerUsername = String(savedProfile?.username || user.user_metadata?.username || '').trim();
      const reviewerName = reviewerUsername ? `@${reviewerUsername}` : String(savedProfile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || 'Renter');
      const reviewerAvatar = String(savedProfile?.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || '');
      const profileUpdate: Record<string, unknown> = {
        renter_id: user.id,
        updated_at: new Date().toISOString(),
      };
      if (reviewerUsername) profileUpdate.username = reviewerUsername;
      if (savedProfile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name) profileUpdate.full_name = savedProfile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name;
      if (reviewerAvatar) profileUpdate.avatar_url = reviewerAvatar;

      // Synchronize the same public username/avatar shown in Profile before the
      // privacy-safe public review function reads the reviewer card.
      const { error: renterError } = await supabase
        .from('renters')
        .upsert(profileUpdate, { onConflict: 'renter_id' });
      if (renterError) throw renterError;

      const photos: string[] = [];
      let photoUploadFailed = false;
      for (const uri of reviewPhotos) {
        try {
          photos.push(await uploadImage(`${user.id}/reviews/${dormId}/${Date.now()}-${photos.length}.${getSafeImageExtension(uri)}`, uri));
        } catch (uploadError: any) {
          photoUploadFailed = true;
          console.warn('Review photo upload skipped:', String(uploadError?.message || uploadError));
        }
      }

      const reviewPayload = {
        dorm_id: dormId,
        user_id: user.id,
        rating: newReview.rating,
        comment: newReview.comment.trim(),
      };
      let insertedReview: any = null;
      let insertResult = await supabase
        .from('dorm_reviews')
        .insert({ ...reviewPayload, photos })
        .select('review_id, rating, comment, photos, created_at')
        .single();
      let error = insertResult.error;
      insertedReview = insertResult.data;
      let postedWithoutPhotos = false;

      // Older deployed databases may not have the photos column yet. Preserve the
      // core review instead of making the whole submission fail.
      if (error && /photos.+schema cache|column.+photos|PGRST204/i.test(String(error.message))) {
        const retry = await supabase
          .from('dorm_reviews')
          .insert(reviewPayload)
          .select('review_id, rating, comment, created_at')
          .single();
        error = retry.error;
        insertedReview = retry.data;
        postedWithoutPhotos = !retry.error && photos.length > 0;
      }

      if (error) throw error;

      setReviewModalVisible(false);
      setNewReview({ rating: 0, comment: '' });
      setReviewPhotos([]);

      let { data, error: refreshError } = await supabase.rpc('get_public_dorm_reviews', { p_dorm_id: dormId });
      if (refreshError) {
        const fallback = await supabase
          .from('dorm_reviews')
          .select('*, renters(username, avatar_url)')
          .eq('dorm_id', dormId)
          .order('created_at', { ascending: false });
        data = (fallback.data || []).map((review: any) => ({
          ...review,
          reviewer_name: review.renters?.username ? `@${review.renters.username}` : 'Renter',
          reviewer_avatar_url: review.renters?.avatar_url || null,
        }));
        refreshError = fallback.error;
      }
      const optimisticReview = insertedReview ? {
        ...insertedReview,
        photos: postedWithoutPhotos ? [] : photos,
        reviewer_name: reviewerName,
        reviewer_avatar_url: reviewerAvatar || null,
        verified_renter: false,
      } : null;
      if (!refreshError) {
        const nextReviews = (data || []).map((review: any) => review.review_id === optimisticReview?.review_id
          ? { ...review, reviewer_name: reviewerName, reviewer_avatar_url: reviewerAvatar || review.reviewer_avatar_url }
          : review);
        if (optimisticReview && !nextReviews.some((review: any) => review.review_id === optimisticReview.review_id)) nextReviews.unshift(optimisticReview);
        setReviews(nextReviews);
      } else if (optimisticReview) {
        setReviews((current) => [optimisticReview, ...current]);
      }

      Alert.alert(
        'Review submitted',
        postedWithoutPhotos
          ? 'Your review was posted. Photos require the latest database update and were not attached this time.'
          : photoUploadFailed
            ? 'Your review was posted, but one or more photos could not be uploaded.'
            : 'Thank you for sharing your experience.',
      );
    } catch (error: any) {
      const message = String(error?.message || 'The review could not be submitted.');
      console.warn('Review submission failed:', message);
      showError(
        'Review could not be submitted',
        /row-level security|permission denied/i.test(message)
          ? 'Your account is not allowed to add this review yet. Apply the latest Supabase runtime update, then try again.'
          : message,
      );
    } finally {
      setSubmittingReview(false);
    }
  };

  const pickReviewPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 4, quality: 0.75 });
    if (!result.canceled) setReviewPhotos((current) => [...current, ...result.assets.map((asset) => asset.uri)].slice(0, 4));
  };

  const removeReviewPhoto = (uri: string) => {
    setReviewPhotos((current) => current.filter((photo) => photo !== uri));
  };

  const pickTransactionImage = async (kind: 'id' | 'payment') => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.8 });
    if (!result.canceled) {
      if (kind === 'id') setIdDocumentUrl(result.assets[0].uri);
      else setPaymentProofUrl(result.assets[0].uri);
    }
  };

  const openExactMap = () => {
    router.push({ pathname: '/(tabs)/map', params: { dormId: dorm.dorm_id, lat: String(dorm.latitude), lng: String(dorm.longitude) } } as never);
  };

  const addToCompare = () => {
    const result = compareIds.includes(dorm.dorm_id) ? 'added' : toggleCompare(dorm.dorm_id);
    if (result === 'limit') Alert.alert('Comparison full', 'Remove one dorm before adding this property.');
    else router.push('/(tabs)/compare');
  };

  const detailMapDorms = useMemo(() => {
    if (!dorm) return [];
    return [{
      ...dorm,
      rating_average: 0,
      rating_count: reviews.length,
      distance_km: null,
      ranking_score: 0,
      max_tenants: dorm.max_tenants || 1,
      occupied_tenants: dorm.occupied_tenants || 0,
      available_slots: Math.max(0, (dorm.max_tenants || 1) - (dorm.occupied_tenants || 0)),
    }];
  }, [dorm, reviews.length]);

  const detailMapCenter = useMemo(() => ({
    latitude: Number(dorm?.latitude || 10.3157),
    longitude: Number(dorm?.longitude || 123.8854),
  }), [dorm]);

  if (loading || authLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!dorm) {
    return (
      <View style={styles.centered}>
        <Text>Dorm not found</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      <View>
      {/* Image Carousel */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageContainer}>
        {dorm.images && Array.isArray(dorm.images) && dorm.images.length > 0 ? (
          dorm.images
            .filter((img: any): img is string => typeof img === 'string' && img.length > 0)
            .map((image: string, index: number) => (
              <Pressable key={index} onPress={() => setPhotoGallery({ photos: dorm.images.filter((uri: unknown) => typeof uri === 'string' && uri.length > 0), index })}><Image source={{ uri: image }} style={[styles.dormImage, { width: Math.max(280, width - 28) }]} /></Pressable>
            ))
        ) : (
          <Image
            source={require('../../assets/placeholder.jpg')}
            style={[styles.dormImage, { width: Math.max(280, width - 28) }]}
          />
        )}
      </ScrollView>

      {/* Dorm Info */}
      <View style={styles.infoContainer}>
        <Text style={styles.dormName}>{dorm.name}</Text>
        <View style={styles.priceAndFavorite}>
          <Text style={styles.dormPrice}>₱{dorm.price}/month</Text>
          {dorm.lgu_certified ? <Pressable accessibilityLabel="LGU certification information" onPress={() => Alert.alert("LGU certified", "This listing has been marked as LGU certified by a RoomScout administrator.")}><Ionicons name="ribbon" size={26} color={AppColors.accent} /></Pressable> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}><Ionicons name="star" size={16} color={AppColors.warning} /><Text style={{ color: AppColors.textSecondary }}>{reviews.length ? (reviews.reduce((sum: number, item: any) => sum + Number(item.rating), 0) / reviews.length).toFixed(1) + ' · ' + reviews.length + ' reviews' : 'No reviews yet'}</Text></View>
        <Text style={styles.dormAddress}>{dorm.address}</Text>
        {isOwner && <View style={styles.ownerShortcuts}><Pressable accessibilityLabel="Edit dorm listing" onPress={() => router.push({ pathname: '/add-dorm', params: { dormId: dorm.dorm_id } } as never)} style={styles.ownerShortcut}><Ionicons name="create-outline" size={21} color={AppColors.accent} /><Text style={styles.ownerShortcutText}>Edit</Text></Pressable><Pressable accessibilityLabel="View dorm requests" onPress={() => router.push({ pathname: '/owner-panel', params: { dormId: dorm.dorm_id, tab: 'requests' } } as never)} style={styles.ownerShortcut}><Ionicons name="mail-outline" size={21} color={AppColors.accent} /><Text style={styles.ownerShortcutText}>Requests</Text>{hasRequestActivity && <View style={styles.activityDot} />}</Pressable><Pressable accessibilityLabel="View dorm tenants" onPress={() => router.push({ pathname: '/owner-panel', params: { dormId: dorm.dorm_id, tab: 'tenants' } } as never)} style={styles.ownerShortcut}><Ionicons name="people-outline" size={21} color={AppColors.accent} /><Text style={styles.ownerShortcutText}>Tenants</Text>{hasTenantActivity && <View style={styles.activityDot} />}</Pressable></View>}
        <View style={styles.detailMap}><LeafletMapView dorms={detailMapDorms} center={detailMapCenter} radiusKm={1} userLocation={null} showAnalytics={false} onSelectDorm={openExactMap} /></View>
        <Pressable style={styles.navigationButton} onPress={openExactMap}><Text style={styles.navigationButtonText}>Open exact location in Maps</Text></Pressable>

        {!authLoading && !isOwner && <View style={styles.primaryActions}><Pressable onPress={addToCompare} style={styles.actionSecondary}><Text style={styles.actionSecondaryText}>Compare</Text></Pressable><Pressable disabled={requestingRental || ['pending', 'payment_submitted', 'awaiting_cash', 'refund_requested', 'refund_sent'].includes(rentalRequestStatus || '') || (!dorm.available && !canCancelRentalRequest(requestDetails))} onPress={() => ['approved', 'reserved'].includes(rentalRequestStatus || '') ? handleCancelRental() : handleRequestRental()} style={styles.actionPrimary}><Text style={styles.actionPrimaryText}>{rentalRequestStatus === 'awaiting_payment' ? 'Review contract & pay' : rentalRequestStatus === 'awaiting_cash' ? 'Pending cash payment' : rentalRequestStatus === 'pending' ? 'Request pending' : rentalRequestStatus === 'payment_submitted' ? 'Payment under review' : ['refund_requested', 'refund_sent'].includes(rentalRequestStatus || '') ? 'Refund in progress' : rentalRequestStatus === 'approved' ? 'Cancel rental' : rentalRequestStatus === 'reserved' ? 'Cancel reservation' : 'Request Rental'}</Text></Pressable></View>}
        <View style={styles.contactCard}>
          <View style={styles.contactHeading}>
            <View style={styles.ownerAvatar}><Ionicons name="person" size={20} color={AppColors.accent} /></View>
            <View style={styles.ownerCopy}>
              <Text style={styles.ownerEyebrow}>LISTING OWNER</Text>
              <Text style={styles.ownerName}>{dorm.owner_display_name || 'Verified listing owner'}</Text>
            </View>
          </View>
          {dorm.contact_phone ? <Pressable onPress={() => Linking.openURL(`tel:${dorm.contact_phone.replace(/[^+0-9]/g, '')}`)} style={styles.contactAction}><Ionicons name="call-outline" size={17} color={AppColors.accent} /><Text style={styles.contactValue}>{dorm.contact_phone}</Text></Pressable> : null}
          {dorm.contact_email ? <Pressable onPress={() => Linking.openURL(`mailto:${dorm.contact_email}`)} style={styles.contactAction}><Ionicons name="mail-outline" size={17} color={AppColors.accent} /><Text style={styles.contactValue} numberOfLines={2}>{dorm.contact_email}</Text></Pressable> : null}
          {!dorm.contact_phone && !dorm.contact_email ? <Text style={styles.contactUnavailable}>Contact details have not been provided.</Text> : null}
        </View>

        {!isOwner && canCancelRentalRequest(requestDetails) && !['approved', 'reserved'].includes(rentalRequestStatus || '') && <Pressable disabled={requestingRental} style={styles.actionSecondary} onPress={handleCancelRental}><Text style={styles.actionSecondaryText}>{requestingRental ? 'Please wait…' : 'Cancel request'}</Text></Pressable>}
        {!isOwner && requestDetails && <Pressable style={styles.actionSecondary} onPress={() => router.push({ pathname: '/booking-history', params: { requestId: requestDetails.request_id } } as never)}><Text style={styles.actionSecondaryText}>Booking status & history</Text></Pressable>}
        {!isOwner && rentalRequestStatus === 'cancelled' && <Text style={{ color: AppColors.textSecondary, paddingVertical: 14 }}>Request cancelled. {requestDetails?.payment_status === 'pending_verification' ? 'Your receipt is still awaiting owner review. ' : ''}{requestDetails?.payment_status === 'paid' ? 'Request the recorded 90% refund in Booking status & history.' : 'Any confirmed payment can enter the refund process in your booking history.'}</Text>}
        {!isOwner && ['refund_requested', 'refund_sent'].includes(rentalRequestStatus || '') && <Text style={{ color: AppColors.textSecondary, paddingVertical: 14 }}>Your cancellation and refund are in progress. Open Booking status & history to view the next step.</Text>}
        {!isOwner && rentalRequestStatus === 'awaiting_cash' && <Text style={{ color: AppColors.warning, paddingVertical: 14 }}>Pending cash payment · Meet the owner to pay. Your tenancy is confirmed when the owner records payment.</Text>}
        <View style={styles.summaryGrid}>
          <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Reservation fee</Text><Text style={styles.summaryValue}>₱{Number(dorm.reservation_fee || 0).toLocaleString('en-PH')}</Text></View>
          <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Room type</Text><Text style={styles.summaryValue}>{dorm.room_type || 'Not specified'}</Text></View>
          <View style={styles.summaryItem}><Text style={styles.summaryLabel}>Availability</Text><Text style={styles.summaryValue}>{Math.max(0, (dorm.max_tenants || 1) - (dorm.occupied_tenants || 0))} of {dorm.max_tenants || 1} slots left</Text></View>
        </View>

        <View style={styles.detailsSection}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Gender Policy:</Text>
            <Text style={styles.detailValue}>{dorm.gender_policy}</Text>
          </View>
          <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Utilities:</Text>
                <Text style={styles.detailValue}>
                  {dorm.utilities && Array.isArray(dorm.utilities) && dorm.utilities.length > 0
                    ? dorm.utilities.join(', ')
                    : 'Not specified'}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Amenities:</Text>
                <Text style={styles.detailValue}>
                  {dorm.amenities && Array.isArray(dorm.amenities) && dorm.amenities.length > 0
                    ? dorm.amenities.join(', ')
                    : 'Not specified'}
                </Text>
              </View>
              <View style={styles.detailRow}><Text style={styles.detailLabel}>House Rules:</Text><Text style={styles.detailValue}>{Array.isArray(dorm.house_rules) && dorm.house_rules.length ? dorm.house_rules.join(', ') : 'No additional rules'}</Text></View>
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Parking:</Text><Text style={styles.detailValue}>{dorm.parking_info || 'None listed'}</Text></View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Curfew:</Text>
                <Text style={styles.detailValue}>
                  {dorm.curfew || 'No curfew'}
                </Text>
              </View>
            </View>

            {/* Availability Status (for owners) */}
            {isOwner && (
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Availability:</Text>
                <Pressable
                  onPress={handleToggleAvailability}
                  style={[
                    styles.statusButton,
                    dorm.available ? styles.availableButton : styles.unavailableButton,
                  ]}
                >
                  <Text style={styles.statusText}>
                    {dorm.available ? 'Available' : 'Not Available'}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Description */}
            <View style={styles.descriptionSection}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.descriptionText}>
                {dorm.description || 'No description provided'}
              </Text>
            </View>

            {/* Reviews Section */}
            <View style={styles.reviewsSection}>
              <View style={styles.reviewsHeader}>
                <Text style={styles.sectionTitle}>Reviews ({reviews.length})</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add review"
                  onPress={() => {
                    if (!user) Alert.alert('Sign In Required', 'Please sign in before leaving a review.');
                    else if (isOwner) Alert.alert('Owner review unavailable', 'You cannot review your own listing.');
                    else setReviewModalVisible(true);
                  }}
                  disabled={isOwner}
                  style={({ pressed }) => [styles.addReviewButton, isOwner && styles.controlDisabled, pressed && styles.controlPressed]}
                >
                  <Ionicons name="create-outline" size={17} color={AppColors.white} />
                  <Text style={styles.addReviewButtonText}>Add review</Text>
                </Pressable>
              </View>

              {reviews.length > 0 ? (
                <View style={styles.reviewsList}>
                  {reviews.map((item) => (
                    <View key={item.review_id} style={styles.reviewItem}>
                      <View style={[styles.reviewHeader, compactLayout && styles.reviewHeaderCompact]}>
                        <View style={styles.reviewerInfo}>
                          {item.reviewer_avatar_url ? (
                            <Image source={{ uri: item.reviewer_avatar_url }} style={styles.avatar} />
                          ) : (
                            <View style={styles.avatarPlaceholder}>
                              <Text style={styles.avatarText}>{String(item.reviewer_name || 'R').replace('@', '').charAt(0).toUpperCase()}</Text>
                            </View>
                          )}
                          <View style={styles.reviewerCopy}>
                            <View style={styles.reviewerNameRow}>
                              <Text style={styles.reviewerName} numberOfLines={1}>{item.reviewer_name || 'Renter'}</Text>
                              {item.verified_renter ? <Ionicons name="checkmark-circle" size={15} color={AppColors.accent} /> : null}
                            </View>
                            <Text style={styles.reviewDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
                          </View>
                        </View>
                        <View style={styles.reviewRating} accessibilityLabel={`${item.rating} out of 5 stars`}>
                          {Array.from({ length: 5 }, (_, index) => (
                            <Ionicons key={index} name={index < item.rating ? 'star' : 'star-outline'} size={18} color={index < item.rating ? AppColors.warning : AppColors.textMuted} />
                          ))}
                        </View>
                      </View>
                      {String(item.comment || '').trim() ? <Text style={styles.reviewComment}>{item.comment}</Text> : null}
                      {Array.isArray(item.photos) && item.photos.length > 0 ? (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reviewPhotoRow}>
                          {item.photos.map((photo: string) => <Pressable key={photo} onPress={() => setPhotoGallery({ photos: item.photos, index: item.photos.indexOf(photo) })}><Image source={{ uri: photo }} style={styles.reviewPhoto} /></Pressable>)}
                        </ScrollView>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.noReviews}>No reviews yet. Be the first to review!</Text>
              )}
            </View>
          </View>
        {photoGallery && <PhotoViewer photos={photoGallery.photos} initialIndex={photoGallery.index} onClose={() => setPhotoGallery(null)} />}
        {/* Review Modal */}
        <Modal visible={reviewModalVisible} transparent={true} animationType="fade" onRequestClose={() => !submittingReview && setReviewModalVisible(false)}>
          <View style={styles.modalBackground}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Leave a Review</Text>
              <View style={styles.ratingSelector}>
                {Array.from({ length: 5 }, (_, index) => (
                  <Pressable
                    key={index}
                    accessibilityRole="button"
                    accessibilityLabel={`${index + 1} star${index ? 's' : ''}`}
                    accessibilityState={{ selected: newReview.rating === index + 1 }}
                    onPress={() => setNewReview((prev) => ({ ...prev, rating: index + 1 }))}
                    hitSlop={6}
                    style={({ pressed }) => [styles.ratingButton, pressed && styles.controlPressed]}
                  >
                    <Ionicons name={newReview.rating >= index + 1 ? 'star' : 'star-outline'} size={36} color={newReview.rating >= index + 1 ? AppColors.warning : AppColors.textMuted} />
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={styles.commentInput}
                placeholder="Share your experience"
                placeholderTextColor={AppColors.placeholder}
                value={newReview.comment}
                onChangeText={(text) => setNewReview((prev: any) => ({ ...prev, comment: text }))}
                multiline
                maxLength={1000}
                textAlignVertical="top"
              />
              <View style={styles.reviewMediaRow}>
                {reviewPhotos.length < 4 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add images"
                    disabled={submittingReview}
                    onPress={pickReviewPhotos}
                    style={({ pressed }) => [styles.addImageButton, pressed && styles.controlPressed]}
                  >
                    <Ionicons name="images-outline" size={25} color={AppColors.accent} />
                  </Pressable>
                ) : null}
                {reviewPhotos.map((uri) => (
                  <View key={uri} style={styles.selectedReviewPhotoWrap}>
                    <Image source={{ uri }} style={styles.selectedReviewPhoto} />
                    <Pressable accessibilityRole="button" accessibilityLabel="Remove image" onPress={() => removeReviewPhoto(uri)} style={styles.removeReviewPhotoButton}>
                      <Ionicons name="close" size={13} color={AppColors.white} />
                    </Pressable>
                  </View>
                ))}
              </View>
              <View style={styles.modalActions}>
                <Pressable disabled={submittingReview} onPress={() => setReviewModalVisible(false)} style={({ pressed }) => [styles.modalButton, styles.modalButtonSecondary, pressed && styles.controlPressed]}>
                  <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
                </Pressable>
                <Pressable disabled={submittingReview} onPress={handleSubmitReview} style={({ pressed }) => [styles.modalButton, styles.modalButtonPrimary, submittingReview && styles.controlDisabled, pressed && styles.controlPressed]}>
                  {submittingReview ? <ActivityIndicator size="small" color={AppColors.white} /> : <Text style={styles.modalButtonPrimaryText}>Submit</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        <ErrorToast />
      </Modal>

        {/* Rental Request Modal */}
        <Modal
          visible={rentalModalVisible && !isOwner && !authLoading}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setRentalModalVisible(false)}
        >
          <View style={styles.modalBackground}>
            <View style={[styles.modalContent, { height: Math.min(620, height * 0.78), width: '94%', maxWidth: 520 }]}>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }}>
                {rentalRequestStatus === 'awaiting_payment' ? (
                  <>
                    <Text style={styles.modalTitle}>Review contract & payment</Text>
                    <Text style={styles.inputLabel}>Required amount</Text>
                    <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 12, color: AppColors.text }}>₱{Number(requestDetails?.required_amount || 0).toLocaleString('en-PH')}</Text>
                    {requestDetails?.payment_method === 'cash' ? <Text style={styles.qrText}>Pay the owner in person and request a signed receipt. Upload the receipt below after payment.</Text> : secureQrUrl ? (
                      <View style={styles.qrContainer}>
                        <Image source={{ uri: secureQrUrl }} style={styles.qrImage} />
                        <Text style={styles.qrText}>Owner payment QR</Text>
                      </View>
                    ) : <Text style={styles.qrText}>The owner has not attached a QR yet.</Text>}
                    {requestDetails?.contract_url ? <BookingDocument path={requestDetails.contract_url} label="Contract" /> : <Text style={styles.qrText}>The contract image is unavailable. Ask the owner to update this request.</Text>}
                    <Pressable accessibilityRole="radio" accessibilityState={{ checked: contractAgreed, disabled: requestingRental }} disabled={requestingRental} onPress={() => setContractAgreed((value) => !value)} style={({ pressed }) => [styles.agreementRow, pressed && styles.controlPressed]}>
                      <Ionicons name={contractAgreed ? 'radio-button-on' : 'radio-button-off'} size={22} color={contractAgreed ? AppColors.accent : AppColors.textSecondary} />
                      <Text style={styles.agreementText}>I reviewed and agree to the contract</Text>
                    </Pressable>
                    <Text style={styles.inputLabel}>Payment proof</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={paymentProofUrl ? 'Replace payment receipt image' : 'Choose payment receipt image'} disabled={requestingRental} onPress={() => pickTransactionImage('payment')} style={({ pressed }) => [styles.photoButton, pressed && styles.controlPressed]}>
                      {paymentProofUrl ? <Image source={{ uri: paymentProofUrl }} style={styles.receiptPreview} resizeMode="contain" /> : <><Ionicons name="image-outline" size={26} color={AppColors.accent} /><Text style={styles.photoButtonText}>Choose receipt image</Text></>}
                    </Pressable>
                    <View style={[styles.modalActions, styles.paymentActions]}>
                      <Pressable accessibilityRole="button" disabled={requestingRental} onPress={() => setRentalModalVisible(false)} style={({ pressed }) => [styles.modalButton, styles.paymentActionButton, styles.modalButtonSecondary, pressed && styles.controlPressed]}><Text style={styles.modalButtonSecondaryText}>Close</Text></Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel="Submit payment proof" accessibilityState={{ disabled: requestingRental, busy: requestingRental }} onPress={() => void submitPaymentProof()} disabled={requestingRental} style={({ pressed }) => [styles.modalButton, styles.paymentActionButton, styles.modalButtonPrimary, requestingRental && styles.controlDisabled, pressed && styles.controlPressed]}>{requestingRental ? <ActivityIndicator color={AppColors.white} /> : <Text style={styles.modalButtonPrimaryText}>Submit</Text>}</Pressable>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.modalTitle}>Submit a request</Text>
                    <Text style={{ color: AppColors.textMuted, marginBottom: 12 }}>Step {requestStep + 1} of 3</Text>
                    {requestStep === 0 && <>
                    <Text style={styles.inputLabel}>Request type</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                      {(['rental', 'reservation'] as const).map((type) => (
                        <Pressable key={type} onPress={() => setRequestType(type)} style={{ flex: 1, padding: 11, borderRadius: 8, alignItems: 'center', backgroundColor: requestType === type ? AppColors.accent : AppColors.surfaceElevated, minHeight: 54, justifyContent: 'center', borderWidth: 1, borderColor: requestType === type ? AppColors.accent : AppColors.border }}>
                          <Text style={{ color: AppColors.text, fontWeight: '700', textTransform: 'capitalize' }}>{type}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {requestType === 'reservation' && <Text style={{ marginBottom: 12, color: AppColors.textSecondary }}>Reservation fee: ₱{Number(dorm.reservation_fee || 0).toLocaleString('en-PH')} (confirmed by owner)</Text>}
                    </>}
                    {requestStep === 1 && <>
                    <Text style={styles.inputLabel}>Payment method</Text>
                    <View style={{ gap: 8, marginBottom: 16 }}>{(['qr', 'cash'] as const).map((method) => <Pressable key={method} onPress={() => setPaymentMethod(method)} style={[styles.paymentChoice, paymentMethod === method && styles.paymentChoiceSelected]}><Ionicons name={method === 'cash' ? 'cash-outline' : 'qr-code-outline'} size={21} color={AppColors.text} /><Text style={{ color: AppColors.text, flex: 1 }}>{method === 'cash' ? 'Cash in person' : 'QR payment'}</Text><Ionicons name={paymentMethod === method ? 'radio-button-on' : 'radio-button-off'} size={20} color={AppColors.accent} /></Pressable>)}</View>
                    </>}
                    {requestStep === 2 && <>
                    <Text style={styles.inputLabel}>Government ID</Text>
                    <Pressable onPress={() => pickTransactionImage('id')} style={styles.photoButton}>{idDocumentUrl ? <Image source={{ uri: idDocumentUrl }} style={{ width: '100%', height: 145, resizeMode: 'contain' }} /> : <><Ionicons name="id-card-outline" size={24} color={AppColors.accent} /><Text style={styles.photoButtonText}>Choose government ID</Text></>}</Pressable>
                    <Text style={styles.inputLabel}>Send a Message</Text>
                    <TextInput placeholderTextColor={AppColors.placeholder} style={[styles.commentInput, { height: 80 }]} maxLength={1000} placeholder="Send a Message" value={extraDetails} onChangeText={setExtraDetails} multiline textAlignVertical="top" />
                    <Text style={{ color: '#6b7280', fontSize: 12, marginBottom: 12 }}>The owner reviews your request first, then sends the contract and payment instructions.</Text>
                    </>}
                    <View style={[styles.modalActions, { marginTop: 'auto', paddingTop: 18 }]}>
                      <Pressable style={[styles.modalButton, styles.modalButtonSecondary]} onPress={() => requestStep === 0 ? setRentalModalVisible(false) : setRequestStep((step) => step - 1)}><Text style={styles.modalButtonSecondaryText}>{requestStep === 0 ? "Cancel" : "Back"}</Text></Pressable>
                      <Pressable disabled={requestingRental} style={[styles.modalButton, styles.modalButtonPrimary, requestingRental && { opacity: 0.5 }]} onPress={() => requestStep < 2 ? setRequestStep((step) => step + 1) : void submitRentalRequest()}>{requestingRental ? <ActivityIndicator color={AppColors.white} /> : <Text style={styles.modalButtonPrimaryText}>{requestStep < 2 ? "Next" : "Submit Request"}</Text>}</Pressable>
                    </View>
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        <ErrorToast />
      </Modal>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  activityDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: AppColors.error },
  ownerShortcuts: { flexDirection: 'row', gap: 20, marginBottom: 16 },
  ownerShortcut: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44 },
  ownerShortcutText: { fontSize: 13, fontWeight: '600', color: AppColors.text },

  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginVertical: 20 },
  summaryItem: { flex: 1, minWidth: 86, paddingVertical: 8, alignItems: 'center', gap: 7 },
  summaryLabel: { fontSize: 11, color: AppColors.textMuted, textAlign: 'center' },
  summaryValue: { fontSize: 14, fontWeight: '600', color: AppColors.text, textAlign: 'center' },
  paymentChoice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderColor: AppColors.border, borderRadius: 10 },
  paymentChoiceSelected: { borderColor: AppColors.accent },

  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  scrollContent: { paddingBottom: 120 },
  imageContainer: {
    height: 238,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  dormImage: {
    height: 218,
    resizeMode: 'cover',
    borderRadius: BorderRadius.xl,
    marginRight: 10,
    backgroundColor: AppColors.surfaceElevated,
  },
  infoContainer: {
    padding: 14,
    backgroundColor: AppColors.background,
  },
  dormName: {
    color: AppColors.text,
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8,
  },
  priceAndFavorite: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  dormPrice: {
    fontSize: 19,
    fontWeight: '800',
    color: AppColors.accent,
  },
  favoriteButton: {
    padding: 8,
  },
  dormAddress: {
    fontSize: 14,
    color: AppColors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  detailsSection: {
    backgroundColor: AppColors.surface,
    borderRadius: BorderRadius.xl,
    padding: 14,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AppColors.borderSubtle,
  },
  detailLabel: {
    flexGrow: 1,
    flexBasis: 108,
    minWidth: 90,
    fontSize: 14,
    color: AppColors.textSecondary,
    fontWeight: '600',
  },
  detailValue: {
    flexGrow: 2,
    flexShrink: 1,
    flexBasis: 150,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'right',
    color: AppColors.text,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: AppColors.text,
  },
  statusButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  availableButton: {
    backgroundColor: '#d4edda',
  },
  unavailableButton: {
    backgroundColor: '#f8d7da',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#212529',
  },
  descriptionSection: {
    padding: 16,
    marginBottom: 14,
    borderRadius: BorderRadius.xl,
    backgroundColor: AppColors.surface,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
  },
  sectionTitle: {
    color: AppColors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  descriptionText: {
    fontSize: 14,
    color: AppColors.textSecondary,
    lineHeight: 21,
  },
  reviewsSection: {
    paddingVertical: 10,
  },
  reviewsHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  addReviewButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: BorderRadius.full,
    backgroundColor: AppColors.accent,
  },
  addReviewButtonText: { color: AppColors.white, fontSize: 13, fontWeight: '800' },
  controlPressed: { opacity: 0.72 },
  controlDisabled: { opacity: 0.45 },
  reviewItem: {
    backgroundColor: AppColors.surface,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  reviewHeaderCompact: { flexDirection: 'column', alignItems: 'flex-start' },
  reviewerInfo: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  avatarPlaceholder: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: AppColors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewerCopy: { flex: 1, minWidth: 0 },
  reviewerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  avatarText: {
    color: AppColors.textSecondary,
    fontWeight: 'bold',
  },
  reviewerName: {
    flexShrink: 1,
    color: AppColors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  reviewDate: {
    fontSize: 12,
    color: AppColors.textMuted,
  },
  reviewRating: {
    flexDirection: 'row',
    gap: 1,
  },
  star: {
    fontSize: 18,
    color: '#FFD700',
  },
  starFilled: {
    color: '#FFD700',
  },
  starEmpty: {
    color: '#E0E0E0',
  },
  reviewComment: {
    fontSize: 14,
    color: AppColors.textSecondary,
    marginTop: 8,
    lineHeight: 20,
  },
  reviewsList: {
    paddingBottom: 20,
  },
  reviewPhotoRow: { paddingTop: 9, gap: 8 },
  noReviews: {
    textAlign: 'center',
    padding: 20,
    color: AppColors.textMuted,
    fontStyle: 'italic',
  },
  modalBackground: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  modalContent: {
    backgroundColor: AppColors.surface,
    borderRadius: BorderRadius.xl,
    padding: 18,
    width: '92%',
    maxWidth: 560,
    maxHeight: '88%',
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  modalTitle: {
    color: AppColors.text,
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  ratingSelector: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
  },
  ratingLabel: {
    color: AppColors.text,
    fontWeight: '700',
    marginRight: 6,
  },
  ratingButton: {
    width: 43,
    height: 43,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingButtonActive: {
    backgroundColor: '#FFD700',
  },
  ratingButtonInactive: {
    backgroundColor: '#e0e0e0',
  },
  ratingButtonText: {
    color: '#333',
    fontWeight: 'bold',
    fontSize: 14,
  },
  commentInput: {
    borderWidth: 1,
    borderColor: AppColors.inputBorder,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
    color: AppColors.text,
    backgroundColor: AppColors.input,
    minHeight: 104,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: AppColors.text,
  },
  qrContainer: {
    alignItems: 'center',
    marginBottom: 16,
    padding: 16,
    backgroundColor: AppColors.surfaceElevated,
    borderRadius: 8,
  },
  qrImage: {
    width: 150,
    height: 150,
    marginBottom: 8,
  },
  qrText: {
    fontSize: 14,
    color: AppColors.textSecondary,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  agreementRow: { alignSelf: 'center', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, paddingVertical: 16, paddingHorizontal: 8 },
  agreementText: { flexShrink: 1, color: AppColors.text, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  receiptPreview: { width: '100%', height: 170 },
  paymentActions: { justifyContent: 'flex-end', flexWrap: 'wrap', paddingTop: 6 },
  paymentActionButton: { flex: 0, minWidth: 92, paddingHorizontal: 18, paddingVertical: 12 },
  modalButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.lg },
  modalButtonSecondary: { borderWidth: 1, borderColor: AppColors.border, backgroundColor: AppColors.surfaceElevated },
  modalButtonPrimary: { backgroundColor: AppColors.accent },
  modalButtonSecondaryText: { color: AppColors.textSecondary, fontWeight: '800' },
  modalButtonPrimaryText: { color: AppColors.white, fontWeight: '800' },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: AppColors.background,
  },
  navigationButton: {
    backgroundColor: AppColors.accent,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  navigationButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  detailMap: { height: 220, overflow: 'hidden', borderRadius: 0, marginBottom: 10 },
  certBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: AppColors.successBg, borderWidth: 1, borderColor: AppColors.success },
  certText: { color: AppColors.success, fontSize: 11, fontWeight: '800' },
  primaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  actionSecondary: { flexGrow: 1, flexBasis: 96, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: AppColors.accent, backgroundColor: AppColors.surfaceElevated },
  actionSecondaryText: { color: AppColors.accent, fontSize: 12, fontWeight: '800' },
  actionPrimary: { flexGrow: 1, flexBasis: 150, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: AppColors.accent },
  actionPrimaryText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  contactCard: { padding: 14, gap: 10, marginBottom: 12, borderRadius: 16, backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.borderSubtle },
  contactHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  ownerAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: AppColors.surfaceElevated },
  ownerCopy: { flex: 1 },
  ownerEyebrow: { color: AppColors.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  ownerName: { color: AppColors.text, fontSize: 16, fontWeight: '800', marginTop: 2 },
  contactAction: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 11, borderRadius: BorderRadius.md, backgroundColor: AppColors.surfaceElevated },
  contactValue: { flex: 1, color: AppColors.accent, fontSize: 14, fontWeight: '700' },
  contactUnavailable: { color: AppColors.textMuted, fontSize: 12 },
  reviewPhoto: { width: 112, height: 84, borderRadius: 10, backgroundColor: AppColors.surfaceElevated },
  reviewMediaRow: { minHeight: 58, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9, marginBottom: 16 },
  addImageButton: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: AppColors.accent, backgroundColor: AppColors.surfaceElevated },
  selectedReviewPhotoWrap: { position: 'relative' },
  selectedReviewPhoto: { width: 54, height: 54, borderRadius: BorderRadius.md, backgroundColor: AppColors.surfaceElevated },
  removeReviewPhotoButton: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: AppColors.error },
  photoButton: { padding: 11, marginBottom: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: AppColors.accent, backgroundColor: AppColors.surfaceElevated },
  photoButtonText: { color: AppColors.accent, fontWeight: '700' },
  rentButton: {
    backgroundColor: '#10b981',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  rentButtonDisabled: {
    backgroundColor: '#9ca3af',
  },
  rentButtonPending: {
    backgroundColor: '#f59e0b',
  },
  rentButtonAccepted: {
    backgroundColor: '#059669',
  },
  rentButtonDeclined: {
    backgroundColor: '#ef4444',
  },
  rentButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
