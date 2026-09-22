import { useState, useCallback } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator, Button, FlatList, Pressable, Modal, TextInput, ScrollView, Linking, Alert } from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';
import * as ImagePicker from 'expo-image-picker';
import { LeafletMapView } from '@/components/leaflet-map-view';
import { useDiscovery } from '@/context/discovery-context';
import { uploadImage, uploadPrivateImage } from '@/utils/imageUpload';

export default function DormDetails() {
  const { dormId } = useLocalSearchParams<{ dormId: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const { compareIds, toggleCompare } = useDiscovery();
  const [dorm, setDorm] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<any[]>([]);
  const [newReview, setNewReview] = useState({ rating: 5, comment: '' });
  const [reviewPhotos, setReviewPhotos] = useState<string[]>([]);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [rentalRequestStatus, setRentalRequestStatus] = useState<string | null>(null);
  const [requestDetails, setRequestDetails] = useState<any | null>(null);
  const [requestingRental, setRequestingRental] = useState(false);
  const [rentalModalVisible, setRentalModalVisible] = useState(false);
  const [idDocumentUrl, setIdDocumentUrl] = useState('');
  const [paymentProofUrl, setPaymentProofUrl] = useState('');
  const [extraDetails, setExtraDetails] = useState('');
  const [requestType, setRequestType] = useState<'rental' | 'reservation'>('rental');
  const [contractAgreed, setContractAgreed] = useState(false);

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
        const fallback = await supabase.from('dorm_reviews').select('*').eq('dorm_id', dormId).order('created_at', { ascending: false });
        reviewsData = fallback.data;
        reviewsError = fallback.error;
      }

      if (reviewsError) throw reviewsError;
      setDorm(dormData);
      setIsOwner(ownerCheck);
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
    try {
      const { error } = await supabase
        .from('dorms')
        .update({ available: !dorm.available })
        .eq('dorm_id', dormId);

      if (error) throw error;

      setDorm((prev: any) => ({
        ...prev,
        available: !prev.available,
      }));
    } catch (error) {
      console.error('Error updating availability:', error);
    }
  };

  const handleRequestRental = (type: 'rental' | 'reservation' = 'rental') => {
    if (!user) {
      Alert.alert('Sign In Required', 'Please sign in to request renting this dormitory.');
      return;
    }
    setRequestType(type);
    setRentalModalVisible(true);
  };

  const submitRentalRequest = async () => {
    if (!user || !dorm) return;

    if (!idDocumentUrl.trim()) {
      Alert.alert('Government ID required', 'Provide the secure ID upload URL before submitting.');
      return;
    }

    setRequestingRental(true);
    try {
      const idPath = idDocumentUrl.startsWith('file:') || idDocumentUrl.startsWith('content:')
        ? await uploadPrivateImage(`${user.id}/government-id/${Date.now()}.${idDocumentUrl.split('.').pop() || 'jpg'}`, idDocumentUrl)
        : idDocumentUrl.trim();
      const { data: existingReq } = await supabase
        .from('rental_requests')
        .select('request_id')
        .eq('dorm_id', dormId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingReq) {
        const { error } = await supabase
          .from('rental_requests')
          .update({
            status: 'pending',
            renter_gov_id_url: idPath,
            payment_proof_url: null,
            message: extraDetails.trim().slice(0, 1000),
            request_type: requestType,
            contract_agreed: false,
            updated_at: new Date().toISOString()
          })
          .eq('request_id', existingReq.request_id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('rental_requests')
          .insert({
            dorm_id: dormId,
            user_id: user.id,
            owner_id: dorm.owner_id,
            status: 'pending',
            renter_gov_id_url: idPath,
            message: extraDetails.trim().slice(0, 1000),
            request_type: requestType,
          });

        if (error) throw error;
      }

      setRentalRequestStatus('pending');
      setRentalModalVisible(false);
      setIdDocumentUrl('');
      setExtraDetails('');
      Alert.alert('Request submitted', `The owner will review your ${requestType} request and ID before sending payment instructions.`);
    } catch (error: any) {
      console.error('Error requesting rental:', error);
      Alert.alert('Error', error.message || 'Failed to submit rental request.');
    } finally {
      setRequestingRental(false);
    }
  };

  const submitPaymentProof = async () => {
    if (!user || !requestDetails?.request_id) return;
    if (!contractAgreed || !paymentProofUrl.trim()) {
      Alert.alert('Complete the payment step', 'Agree to the contract and provide a payment proof URL.');
      return;
    }

    setRequestingRental(true);
    try {
      const paymentPath = paymentProofUrl.startsWith('file:') || paymentProofUrl.startsWith('content:')
        ? await uploadPrivateImage(`${user.id}/payment-proof/${Date.now()}.${paymentProofUrl.split('.').pop() || 'jpg'}`, paymentProofUrl)
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
        .eq('user_id', user.id);
      if (error) throw error;

      setRentalRequestStatus('payment_submitted');
      setRequestDetails((current: any) => ({ ...current, status: 'payment_submitted', contract_agreed: true }));
      setRentalModalVisible(false);
      setPaymentProofUrl('');
      setContractAgreed(false);
      Alert.alert('Payment proof submitted', 'The admin and dorm owner can now review the proof.');
    } catch (error: any) {
      Alert.alert('Upload failed', error.message || 'Could not submit payment proof.');
    } finally {
      setRequestingRental(false);
    }
  };

  const handleCancelRental = async () => {
    if (!user || !dorm) return;
    Alert.alert(
      'Cancel Rental',
      'Are you sure you want to cancel your rental agreement for this dormitory?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel Rental',
          style: 'destructive',
          onPress: async () => {
            setRequestingRental(true);
            try {
              // Use RPC function (security definer) so tenant can update dorm availability
              const { error: rpcError } = await supabase.rpc('cancel_rental', {
                p_dorm_id: dormId,
              });

              if (rpcError) throw rpcError;

              // Notify the owner
              await supabase.from('notifications').insert({
                user_id: dorm.owner_id,
                title: 'Rental Cancelled by Tenant',
                message: `${user.user_metadata?.full_name || user.email || 'A tenant'} has cancelled their rental agreement for: ${dorm.name}.`,
                type: 'info',
                related_dorm_id: dormId,
              });

              setRentalRequestStatus(null);
              setDorm((prev: any) => ({ ...prev, available: true }));
              Alert.alert('Success', 'Your rental agreement has been cancelled.');
            } catch (error: any) {
              console.error('Error cancelling rental:', error);
              Alert.alert('Error', error.message || 'Failed to cancel rental.');
            } finally {
              setRequestingRental(false);
            }
          }
        }
      ]
    );
  };

  const handleSubmitReview = async () => {
    if (!user) return;

    if (!newReview.comment.trim()) {
      alert('Please write a comment');
      return;
    }

    try {
      const photos: string[] = [];
      for (const uri of reviewPhotos) photos.push(await uploadImage(`${user.id}/reviews/${dormId}/${Date.now()}-${photos.length}.${uri.split('.').pop() || 'jpg'}`, uri));
      const { error } = await supabase
        .from('dorm_reviews')
        .insert({
          dorm_id: dormId,
          user_id: user.id,
          rating: newReview.rating,
          comment: newReview.comment,
          photos,
        });

      if (error) throw error;

      setReviewModalVisible(false);
      setNewReview({ rating: 5, comment: '' });
      setReviewPhotos([]);

      // Refresh reviews
      const { data } = await supabase.rpc('get_public_dorm_reviews', { p_dorm_id: dormId });

      setReviews(data || []);
    } catch (error) {
      console.error('Error submitting review:', error);
      alert('Failed to submit review');
    }
  };

  const pickReviewPhotos = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: 4, quality: 0.75 });
    if (!result.canceled) setReviewPhotos(result.assets.map((asset) => asset.uri).slice(0, 4));
  };

  const pickTransactionImage = async (kind: 'id' | 'payment') => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, quality: 0.8 });
    if (!result.canceled) {
      if (kind === 'id') setIdDocumentUrl(result.assets[0].uri);
      else setPaymentProofUrl(result.assets[0].uri);
    }
  };

  const openExactMap = async () => {
    const geo = `geo:${dorm.latitude},${dorm.longitude}?q=${dorm.latitude},${dorm.longitude}(${encodeURIComponent(dorm.name)})`;
    if (await Linking.canOpenURL(geo)) await Linking.openURL(geo);
    else await Linking.openURL(`https://www.openstreetmap.org/?mlat=${dorm.latitude}&mlon=${dorm.longitude}#map=18/${dorm.latitude}/${dorm.longitude}`);
  };

  const addToCompare = () => {
    const result = compareIds.includes(dorm.dorm_id) ? 'added' : toggleCompare(dorm.dorm_id);
    if (result === 'limit') Alert.alert('Comparison full', 'Remove one dorm before adding this property.');
    else router.push('/(tabs)/compare');
  };

  if (loading) {
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
    <ScrollView style={styles.container}>
      <View>
      {/* Image Carousel */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageContainer}>
        {dorm.images && Array.isArray(dorm.images) && dorm.images.length > 0 ? (
          dorm.images
            .filter((img: any): img is string => typeof img === 'string' && img.length > 0)
            .map((image: string, index: number) => (
              <Image
                key={index}
                source={{ uri: image }}
                style={styles.dormImage}
              />
            ))
        ) : (
          <Image
            source={require('../../assets/placeholder.jpg')}
            style={styles.dormImage}
          />
        )}
      </ScrollView>

      {/* Dorm Info */}
      <View style={styles.infoContainer}>
        <Text style={styles.dormName}>{dorm.name}</Text>
        <View style={styles.priceAndFavorite}>
          <Text style={styles.dormPrice}>₱{dorm.price}/month</Text>
          {dorm.lgu_certified ? <View style={styles.certBadge}><Text style={styles.certText}>✓ LGU Certified</Text></View> : null}
        </View>
        <Text style={styles.dormAddress}>{dorm.address}</Text>
        <View style={styles.detailMap}><LeafletMapView dorms={[{ ...dorm, rating_average: 0, rating_count: reviews.length, distance_km: null, ranking_score: 0, max_tenants: dorm.max_tenants || 1, occupied_tenants: dorm.occupied_tenants || 0, available_slots: Math.max(0, (dorm.max_tenants || 1) - (dorm.occupied_tenants || 0)) }]} center={{ latitude: Number(dorm.latitude), longitude: Number(dorm.longitude) }} radiusKm={1} userLocation={null} showAnalytics={false} onSelectDorm={openExactMap} /></View>
        <Pressable style={styles.navigationButton} onPress={openExactMap}><Text style={styles.navigationButtonText}>Open exact location in Maps</Text></Pressable>

        {!isOwner && <View style={styles.primaryActions}><Pressable onPress={addToCompare} style={styles.actionSecondary}><Text style={styles.actionSecondaryText}>Compare</Text></Pressable><Pressable disabled={!dorm.available} onPress={() => handleRequestRental('reservation')} style={styles.actionSecondary}><Text style={styles.actionSecondaryText}>Reserve</Text></Pressable><Pressable disabled={!dorm.available} onPress={() => handleRequestRental('rental')} style={styles.actionPrimary}><Text style={styles.actionPrimaryText}>Request Rental</Text></Pressable></View>}
        {(dorm.contact_phone || dorm.contact_email) && <Pressable onPress={() => dorm.contact_phone ? Linking.openURL(`tel:${dorm.contact_phone.replace(/[^+0-9]/g, '')}`) : Linking.openURL(`mailto:${dorm.contact_email}`)} style={styles.contactCard}><Text style={styles.detailLabel}>Owner contact</Text><Text style={styles.contactValue}>{dorm.contact_phone || dorm.contact_email}</Text></Pressable>}

        {false && !isOwner && (
          <Pressable
            style={[
              styles.rentButton,
              (dorm.available === false && rentalRequestStatus !== 'accepted') && styles.rentButtonDisabled,
              rentalRequestStatus === 'pending' && styles.rentButtonPending,
              rentalRequestStatus === 'accepted' && styles.rentButtonAccepted,
              rentalRequestStatus === 'declined' && styles.rentButtonDeclined,
            ]}
            onPress={['approved', 'reserved', 'accepted'].includes(rentalRequestStatus || '') ? handleCancelRental : () => handleRequestRental('rental')}
            disabled={
              requestingRental ||
              (dorm.available === false && !['approved', 'reserved', 'accepted'].includes(rentalRequestStatus || '')) ||
              ['pending', 'payment_submitted'].includes(rentalRequestStatus || '')
            }
          >
            {requestingRental ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.rentButtonText}>
                {dorm.available === false && rentalRequestStatus !== 'accepted' && 'Dorm Unavailable'}
                {['approved', 'accepted'].includes(rentalRequestStatus || '') && 'Rental Confirmed (Tap to Cancel)'}
                {rentalRequestStatus === 'reserved' && 'Reserved (Tap to Start Refund)'}
                {rentalRequestStatus === 'awaiting_payment' && 'Review Contract & Pay'}
                {rentalRequestStatus === 'payment_submitted' && 'Payment Verification Pending'}
                {dorm.available && rentalRequestStatus === null && 'Request to Rent'}
                {dorm.available && rentalRequestStatus === 'pending' && 'Request Pending'}
                {dorm.available && rentalRequestStatus === 'declined' && 'Request Declined (Retry)'}
              </Text>
            )}
          </Pressable>
        )}

        <View style={styles.detailsSection}>
          <View style={styles.detailRow}><Text style={styles.detailLabel}>Reservation Fee:</Text><Text style={styles.detailValue}>₱{Number(dorm.reservation_fee || 0).toLocaleString('en-PH')}</Text></View>
          <View style={styles.detailRow}><Text style={styles.detailLabel}>Availability:</Text><Text style={styles.detailValue}>{Math.max(0, (dorm.max_tenants || 1) - (dorm.occupied_tenants || 0))} of {dorm.max_tenants || 1} tenant slots left</Text></View>
          <View style={styles.detailRow}><Text style={styles.detailLabel}>Owner:</Text><Text style={styles.detailValue}>{dorm.owner_display_name || 'Verified listing owner'}</Text></View>
          <View style={styles.detailRow}><Text style={styles.detailLabel}>Overall Rating:</Text><Text style={styles.detailValue}>{reviews.length ? `${(reviews.reduce((sum: number, item: any) => sum + Number(item.rating || 0), 0) / reviews.length).toFixed(1)} (${reviews.length} reviews)` : 'New listing'}</Text></View>
          <View style={styles.detailRow}><Text style={styles.detailLabel}>Room Type:</Text><Text style={styles.detailValue}>{dorm.room_type || 'Not specified'}</Text></View>
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
                <Button
                  title="Add Review"
                  onPress={() => setReviewModalVisible(true)}
                  disabled={!user}
                />
              </View>

              {reviews.length > 0 ? (
                <FlatList
                  data={reviews}
                  keyExtractor={(item) => item.review_id}
                  renderItem={({ item }) => (
                    <View style={styles.reviewItem}>
                      <View style={styles.reviewHeader}>
                        <View style={styles.reviewerInfo}>
                          {item.reviewer_avatar_url ? (
                            <Image
                              source={{ uri: item.reviewer_avatar_url }}
                              style={styles.avatar}
                            />
                          ) : (
                            <View style={styles.avatarPlaceholder}>
                              <Text style={styles.avatarText}>
                                {(item.reviewer_name || 'R').charAt(0)}
                              </Text>
                            </View>
                          )}
                          <View>
                            <Text style={styles.reviewerName}>
                              {item.reviewer_name || 'Room Scout renter'} {item.verified_renter ? '✓' : ''}
                            </Text>
                            <Text style={styles.reviewDate}>
                              {new Date(item.created_at).toLocaleDateString()}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.reviewRating}>
                          {/* Star rating display */}
                          {Array(5)
                            .fill(0)
                            .map((_, index) => (
                              <Text
                                key={index}
                                style={[
                                  styles.star,
                                  index < item.rating ? styles.starFilled : styles.starEmpty,
                                ]}
                              >
                                ★
                              </Text>
                            ))}
                        </View>
                      </View>
                      <Text style={styles.reviewComment}>{item.comment}</Text>
                      {Array.isArray(item.photos) && item.photos.length > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false}>{item.photos.map((photo: string) => <Image key={photo} source={{ uri: photo }} style={styles.reviewPhoto} />)}</ScrollView> : null}
                    </View>
                  )}
                  contentContainerStyle={styles.reviewsList}
                />
              ) : (
                <Text style={styles.noReviews}>No reviews yet. Be the first to review!</Text>
              )}
            </View>
          </View>
        {/* Review Modal */}
        <Modal visible={reviewModalVisible} transparent={true} animationType="fade">
          <View style={styles.modalBackground}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Leave a Review</Text>
              <View style={styles.ratingSelector}>
                <Text>Rating:</Text>
                {Array(5)
                  .fill(0)
                  .map((_, index) => (
                    <Pressable
                      key={index}
                      onPress={() => setNewReview((prev: any) => ({ ...prev, rating: index + 1 }))}
                      style={[
                        styles.ratingButton,
                        newReview.rating >= index + 1 ? styles.ratingButtonActive : styles.ratingButtonInactive,
                      ]}
                    >
                      <Text style={styles.ratingButtonText}>
                        {index + 1}
                      </Text>
                    </Pressable>
                  ))}
              </View>
              <TextInput
                style={styles.commentInput}
                placeholder="Write your comment..."
                value={newReview.comment}
                onChangeText={(text) => setNewReview((prev: any) => ({ ...prev, comment: text }))}
              />
              <Pressable onPress={pickReviewPhotos} style={styles.photoButton}><Text style={styles.photoButtonText}>{reviewPhotos.length ? `${reviewPhotos.length} photo(s) selected` : 'Add review photos'}</Text></Pressable>
              <View style={styles.modalActions}>
                <Button title="Cancel" onPress={() => setReviewModalVisible(false)} />
                <Button title="Submit" onPress={handleSubmitReview} />
              </View>
            </View>
          </View>
        </Modal>

        {/* Rental Request Modal */}
        <Modal
          visible={rentalModalVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setRentalModalVisible(false)}
        >
          <View style={styles.modalBackground}>
            <View style={styles.modalContent}>
              <ScrollView showsVerticalScrollIndicator={false}>
                {rentalRequestStatus === 'awaiting_payment' ? (
                  <>
                    <Text style={styles.modalTitle}>Review contract & payment</Text>
                    <Text style={styles.inputLabel}>Required amount</Text>
                    <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 12 }}>₱{Number(requestDetails?.required_amount || 0).toLocaleString('en-PH')}</Text>
                    {requestDetails?.owner_payment_qr_url ? (
                      <View style={styles.qrContainer}>
                        <Image source={{ uri: requestDetails.owner_payment_qr_url }} style={styles.qrImage} />
                        <Text style={styles.qrText}>Owner payment QR</Text>
                      </View>
                    ) : <Text style={styles.qrText}>The owner has not attached a QR yet.</Text>}
                    <Text style={styles.inputLabel}>Contract</Text>
                    <Pressable onPress={() => requestDetails?.contract_url && Linking.openURL(requestDetails.contract_url)}>
                      <Text style={{ color: '#2563eb', marginBottom: 12 }}>{requestDetails?.contract_url ? 'Open contract document' : 'Contract link unavailable'}</Text>
                    </Pressable>
                    <Pressable onPress={() => setContractAgreed((value) => !value)} style={{ padding: 12, borderWidth: 1, borderColor: contractAgreed ? '#16a34a' : '#d1d5db', borderRadius: 8, marginBottom: 12 }}>
                      <Text>{contractAgreed ? '✓ ' : ''}I reviewed and agree to the contract</Text>
                    </Pressable>
                    <Text style={styles.inputLabel}>Payment proof</Text>
                    <Pressable onPress={() => pickTransactionImage('payment')} style={styles.photoButton}><Text style={styles.photoButtonText}>{paymentProofUrl ? 'Change selected receipt' : 'Choose receipt image'}</Text></Pressable>
                    <View style={styles.modalActions}>
                      <Button title="Cancel" onPress={() => setRentalModalVisible(false)} color="#999" />
                      <Button title="Submit Payment Proof" onPress={submitPaymentProof} disabled={requestingRental} />
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.modalTitle}>Submit a request</Text>
                    <Text style={styles.inputLabel}>Request type</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                      {(['rental', 'reservation'] as const).map((type) => (
                        <Pressable key={type} onPress={() => setRequestType(type)} style={{ flex: 1, padding: 11, borderRadius: 8, alignItems: 'center', backgroundColor: requestType === type ? '#2563eb' : '#e5e7eb' }}>
                          <Text style={{ color: requestType === type ? '#fff' : '#111', fontWeight: '700', textTransform: 'capitalize' }}>{type}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {requestType === 'reservation' && <Text style={{ marginBottom: 12, color: '#6b7280' }}>Reservation fee: ₱{Number(dorm.reservation_fee || 0).toLocaleString('en-PH')} (confirmed by owner)</Text>}
                    <Text style={styles.inputLabel}>Government ID</Text>
                    <Pressable onPress={() => pickTransactionImage('id')} style={styles.photoButton}><Text style={styles.photoButtonText}>{idDocumentUrl ? 'Change selected ID image' : 'Choose ID image securely'}</Text></Pressable>
                    <Text style={styles.inputLabel}>Move-in details or message (optional)</Text>
                    <TextInput style={[styles.commentInput, { height: 80 }]} maxLength={1000} placeholder="Move-in date and questions for the owner" value={extraDetails} onChangeText={setExtraDetails} multiline textAlignVertical="top" />
                    <Text style={{ color: '#6b7280', fontSize: 12, marginBottom: 12 }}>Payment is requested only after the owner accepts and sends a QR and contract.</Text>
                    <View style={styles.modalActions}>
                      <Button title="Cancel" onPress={() => setRentalModalVisible(false)} color="#999" />
                      <Button title="Submit Request" onPress={submitRentalRequest} disabled={requestingRental} />
                    </View>
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f8fafc',
    ...StyleSheet.absoluteFill as any,
  },
  imageContainer: {
    height: 200,
  },
  dormImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  infoContainer: {
    padding: 16,
    backgroundColor: '#f8fafc',
  },
  dormName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  priceAndFavorite: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  dormPrice: {
    fontSize: 20,
    fontWeight: '600',
    color: '#007AFF',
  },
  favoriteButton: {
    padding: 8,
  },
  dormAddress: {
    fontSize: 16,
    color: '#666',
    marginBottom: 16,
  },
  detailsSection: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  detailLabel: {
    fontSize: 14,
    color: '#555',
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 14,
    color: '#333',
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
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  descriptionText: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  reviewsSection: {
    padding: 16,
  },
  reviewsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  reviewItem: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    boxShadow: '0 5px 18px rgba(15,23,42,0.08)',
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  reviewerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 8,
  },
  avatarPlaceholder: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#666',
    fontWeight: 'bold',
  },
  reviewerName: {
    fontSize: 14,
    fontWeight: '600',
  },
  reviewDate: {
    fontSize: 12,
    color: '#666',
  },
  reviewRating: {
    flexDirection: 'row',
    marginLeft: 12,
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
    color: '#555',
    marginTop: 8,
    lineHeight: 20,
  },
  reviewsList: {
    paddingBottom: 20,
  },
  noReviews: {
    textAlign: 'center',
    padding: 20,
    color: '#999',
    fontStyle: 'italic',
  },
  modalBackground: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '80%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  ratingSelector: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  ratingButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginHorizontal: 4,
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
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  qrContainer: {
    alignItems: 'center',
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },
  qrImage: {
    width: 150,
    height: 150,
    marginBottom: 8,
  },
  qrText: {
    fontSize: 14,
    color: '#666',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navigationButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  navigationButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  detailMap: { height: 210, overflow: 'hidden', borderRadius: 18, marginBottom: 10, borderWidth: 1, borderColor: '#dbeafe' },
  certBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#dcfce7' },
  certText: { color: '#15803d', fontSize: 11, fontWeight: '800' },
  primaryActions: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  actionSecondary: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  actionSecondaryText: { color: '#1d4ed8', fontSize: 12, fontWeight: '800' },
  actionPrimary: { flex: 1.35, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#2563eb' },
  actionPrimaryText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  contactCard: { padding: 13, marginBottom: 12, borderRadius: 14, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  contactValue: { color: '#2563eb', fontSize: 15, fontWeight: '700', paddingTop: 4 },
  reviewPhoto: { width: 112, height: 84, borderRadius: 10, marginTop: 9, marginRight: 8 },
  photoButton: { padding: 11, marginBottom: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#93c5fd', backgroundColor: '#eff6ff' },
  photoButtonText: { color: '#1d4ed8', fontWeight: '700' },
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
