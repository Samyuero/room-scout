import { useState, useCallback } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator, Button, FlatList, Pressable, Modal, TextInput, ScrollView, Platform, Linking, Alert } from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/hooks/useAuth';

export default function DormDetails() {
  const { dormId } = useLocalSearchParams<{ dormId: string }>();
  const { user } = useAuth();
  const [dorm, setDorm] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<any[]>([]);
  const [newReview, setNewReview] = useState({ rating: 5, comment: '' });
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [rentalRequestStatus, setRentalRequestStatus] = useState<string | null>(null);
  const [requestingRental, setRequestingRental] = useState(false);

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
      const { data: reviewsData, error: reviewsError } = await supabase
        .from('dorm_reviews')
        .select('*, profiles!inner(full_name, username, avatar_url)')
        .eq('dorm_id', dormId)
        .order('created_at', { ascending: false });

      setDorm(dormData);
      setIsOwner(ownerCheck);
      setReviews(reviewsData || []);

      if (user && !ownerCheck) {
        const { data: reqData, error: reqError } = await supabase
          .from('rental_requests')
          .select('status')
          .eq('dorm_id', dormId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!reqError && reqData) {
          setRentalRequestStatus(reqData.status);
        } else {
          setRentalRequestStatus(null);
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

  const handleFavorite = async () => {
    if (!dorm || !dormId) return;
    try {
      const { error } = await supabase
        .from('dorms')
        .update({ is_featured: !dorm.is_featured })
        .eq('dorm_id', dormId);

      if (error) throw error;

      setDorm((prev: any) => ({
        ...prev,
        is_featured: !prev.is_featured,
      }));
    } catch (error) {
      console.error('Error updating favorite status:', error);
    }
  };

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

  const handleRequestRental = async () => {
    if (!user) {
      Alert.alert('Sign In Required', 'Please sign in to request renting this dormitory.');
      return;
    }
    if (!dorm) return;

    setRequestingRental(true);
    try {
      const { data: existingReq } = await supabase
        .from('rental_requests')
        .select('request_id')
        .eq('dorm_id', dormId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingReq) {
        const { error } = await supabase
          .from('rental_requests')
          .update({ status: 'pending', updated_at: new Date().toISOString() })
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
          });

        if (error) throw error;
      }

      // Create notification for the owner
      await supabase.from('notifications').insert({
        user_id: dorm.owner_id,
        title: 'New Rental Request',
        message: `${user.user_metadata?.full_name || user.email || 'A user'} has requested to rent your dormitory: ${dorm.name}.`,
        type: 'rental_request',
        related_dorm_id: dormId,
      });

      setRentalRequestStatus('pending');
      Alert.alert('Success', 'Your rental request has been submitted to the dorm owner!');
    } catch (error: any) {
      console.error('Error requesting rental:', error);
      Alert.alert('Error', error.message || 'Failed to submit rental request.');
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
      const { error } = await supabase
        .from('dorm_reviews')
        .insert({
          dorm_id: dormId,
          user_id: user.id,
          rating: newReview.rating,
          comment: newReview.comment,
        });

      if (error) throw error;

      setReviewModalVisible(false);
      setNewReview({ rating: 5, comment: '' });

      // Refresh reviews
      const { data } = await supabase
        .from('dorm_reviews')
        .select('*, profiles!inner(full_name, username, avatar_url)')
        .eq('dorm_id', dormId)
        .order('created_at', { ascending: false });

      setReviews(data || []);
    } catch (error) {
      console.error('Error submitting review:', error);
      alert('Failed to submit review');
    }
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
          <Pressable onPress={handleFavorite} style={styles.favoriteButton}>
            {dorm.is_featured ? (
              <Text style={{ color: '#FF0000', fontWeight: 'bold' }}>★</Text>
            ) : (
              <Text style={{ color: '#CCCCCC', fontSize: 24 }}>☆</Text>
            )}
          </Pressable>
        </View>
        <Text style={styles.dormAddress}>{dorm.address}</Text>
        <Pressable 
          style={styles.navigationButton}
          onPress={() => {
            const lat = dorm.latitude;
            const lon = dorm.longitude;
            const url = Platform.select({
              ios: `maps://app?daddr=${lat},${lon}`,
              android: `google.navigation:q=${lat},${lon}`,
            });

            if (url) {
              Linking.canOpenURL(url).then((supported) => {
                if (supported) {
                  Linking.openURL(url);
                } else {
                  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`);
                }
              });
            }
          }}
        >
          <Text style={styles.navigationButtonText}>🚗 Get Directions (Open Map)</Text>
        </Pressable>

        {!isOwner && (
          <Pressable
            style={[
              styles.rentButton,
              (dorm.available === false && rentalRequestStatus !== 'accepted') && styles.rentButtonDisabled,
              rentalRequestStatus === 'pending' && styles.rentButtonPending,
              rentalRequestStatus === 'accepted' && styles.rentButtonAccepted,
              rentalRequestStatus === 'declined' && styles.rentButtonDeclined,
            ]}
            onPress={rentalRequestStatus === 'accepted' ? handleCancelRental : handleRequestRental}
            disabled={
              requestingRental ||
              (dorm.available === false && rentalRequestStatus !== 'accepted') ||
              rentalRequestStatus === 'pending'
            }
          >
            {requestingRental ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.rentButtonText}>
                {dorm.available === false && rentalRequestStatus !== 'accepted' && 'Dorm Unavailable'}
                {rentalRequestStatus === 'accepted' && 'Rental Accepted (Tap to Cancel)'}
                {dorm.available && rentalRequestStatus === null && 'Request to Rent'}
                {dorm.available && rentalRequestStatus === 'pending' && 'Request Pending'}
                {dorm.available && rentalRequestStatus === 'declined' && 'Request Declined (Retry)'}
              </Text>
            )}
          </Pressable>
        )}

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
                          {item.profiles?.avatar_url && typeof item.profiles.avatar_url === 'string' && item.profiles.avatar_url.length > 0 ? (
                            <Image
                              source={{ uri: item.profiles.avatar_url }}
                              style={styles.avatar}
                            />
                          ) : (
                            <View style={styles.avatarPlaceholder}>
                              <Text style={styles.avatarText}>
                                {(item.profiles?.full_name || item.profiles?.username || 'A').charAt(0)}
                              </Text>
                            </View>
                          )}
                          <View>
                            <Text style={styles.reviewerName}>
                              {item.profiles?.full_name || item.profiles?.username || 'Anonymous'}
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
              <View style={styles.modalActions}>
                <Button title="Cancel" onPress={() => setReviewModalVisible(false)} />
                <Button title="Submit" onPress={handleSubmitReview} />
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
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
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
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
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    elevation: 2,
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