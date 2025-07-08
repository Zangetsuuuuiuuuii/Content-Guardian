// User Management for Content Guardian
// Handles user linking and relationship management

class UserManagement {
  constructor() {
    this.initializeStorage();
    this.debug = true; // Enable debugging
  }
  
  // Initialize storage structures if needed
  initializeStorage() {
    // Central users database
    if (!localStorage.getItem('contentGuardianUsersDB')) {
      localStorage.setItem('contentGuardianUsersDB', JSON.stringify([]));
    }
    
    // Relationships database (guardian-user connections)
    if (!localStorage.getItem('contentGuardianRelationshipsDB')) {
      localStorage.setItem('contentGuardianRelationshipsDB', JSON.stringify([]));
    }
    
    // Make sure the format is correct
    this.validateAndFixDatabases();
  }
  
  // Make sure the databases are in correct format
  validateAndFixDatabases() {
    try {
      // Users database
      let usersDB = JSON.parse(localStorage.getItem('contentGuardianUsersDB') || '[]');
      if (!Array.isArray(usersDB)) {
        this.log('Users database is not an array, resetting');
        usersDB = [];
      }
      
      // Relationships database
      let relationshipsDB = JSON.parse(localStorage.getItem('contentGuardianRelationshipsDB') || '[]');
      if (!Array.isArray(relationshipsDB)) {
        this.log('Relationships database is not an array, resetting');
        relationshipsDB = [];
      }
      
      // Save the validated databases
      localStorage.setItem('contentGuardianUsersDB', JSON.stringify(usersDB));
      localStorage.setItem('contentGuardianRelationshipsDB', JSON.stringify(relationshipsDB));
      
      // Migrate old data if present
      this.migrateOldData();
    } catch (error) {
      this.log('Error validating databases:', error);
    }
  }
  
  // Migrate data from old storage format to new format
  migrateOldData() {
    try {
      // Check for old users data
      const oldUsers = JSON.parse(localStorage.getItem('contentGuardianUsers') || '[]');
      if (Array.isArray(oldUsers) && oldUsers.length > 0) {
        this.log('Found old users data, migrating...');
        
        // Get current users
        const usersDB = JSON.parse(localStorage.getItem('contentGuardianUsersDB') || '[]');
        
        // Add old users if they don't exist in new database
        const existingEmails = usersDB.map(user => user.email.toLowerCase());
        for (const oldUser of oldUsers) {
          if (oldUser.email && !existingEmails.includes(oldUser.email.toLowerCase())) {
            // Add missing fields
            const newUser = {
              id: usersDB.length + 1,
              full_name: oldUser.full_name || 'Unknown',
              email: oldUser.email,
              password: oldUser.password || 'password123',
              role: oldUser.role || 'user',
              created_at: oldUser.created_at || new Date().toISOString(),
              guardians_count: 0 // New field to track number of linked guardians
            };
            
            usersDB.push(newUser);
            this.log(`Migrated old user: ${newUser.email}`);
          }
        }
        
        // Save updated database
        localStorage.setItem('contentGuardianUsersDB', JSON.stringify(usersDB));
        
        // Check for old user links
        const oldLinks = JSON.parse(localStorage.getItem('contentGuardianUserLinks') || '{}');
        if (typeof oldLinks === 'object' && Object.keys(oldLinks).length > 0) {
          this.log('Found old relationships data, migrating...');
          
          // Get current relationships
          const relationshipsDB = JSON.parse(localStorage.getItem('contentGuardianRelationshipsDB') || '[]');
          
          // Process each guardian and their linked users
          for (const [guardianEmail, userEmails] of Object.entries(oldLinks)) {
            if (Array.isArray(userEmails)) {
              const guardian = this.getUserByEmail(guardianEmail);
              
              if (guardian) {
                // Add relationships for each user
                for (const userEmail of userEmails) {
                  const user = this.getUserByEmail(userEmail);
                  
                  if (user) {
                    // Check if relationship already exists
                    const existingRelationship = relationshipsDB.some(r => 
                      r.guardian_id === guardian.id && r.user_id === user.id
                    );
                    
                    if (!existingRelationship) {
                      // Create new relationship
                      const newRelationship = {
                        id: relationshipsDB.length + 1,
                        guardian_id: guardian.id,
                        user_id: user.id,
                        status: 'active',
                        created_at: new Date().toISOString()
                      };
                      
                      relationshipsDB.push(newRelationship);
                      
                      // Update user's guardians count
                      this.updateGuardianCount(user.id);
                      
                      this.log(`Migrated relationship: ${guardian.email} -> ${user.email}`);
                    }
                  }
                }
              }
            }
          }
          
          // Save updated relationships
          localStorage.setItem('contentGuardianRelationshipsDB', JSON.stringify(relationshipsDB));
        }
      }
    } catch (error) {
      this.log('Error migrating old data:', error);
    }
  }
  
  // Update the guardians count for a user
  updateGuardianCount(userId) {
    try {
      const usersDB = JSON.parse(localStorage.getItem('contentGuardianUsersDB') || '[]');
      const relationshipsDB = JSON.parse(localStorage.getItem('contentGuardianRelationshipsDB') || '[]');
      
      // Find the user
      const userIndex = usersDB.findIndex(u => u.id === userId);
      if (userIndex === -1) {
        this.log(`User ID ${userId} not found for guardian count update`);
        return 0;
      }
      
      // Count active relationships where this user is involved
      const guardianCount = relationshipsDB.filter(r => 
        r.user_id === userId && r.status === 'active'
      ).length;
      
      this.log(`Calculated guardian count for user ID ${userId}: ${guardianCount}`);
      
      // Update the user
      usersDB[userIndex].guardians_count = guardianCount;
      
      // Save changes
      localStorage.setItem('contentGuardianUsersDB', JSON.stringify(usersDB));
      
      // Get the user's email for logging
      const userEmail = usersDB[userIndex].email;
      this.log(`Updated guardian count for ${userEmail} to ${guardianCount}`);
      
      return guardianCount;
    } catch (error) {
      this.log(`Error updating guardian count: ${error.message}`);
      return 0;
    }
  }
  
  // Log debug information
  log(...args) {
    if (this.debug) {
      console.log('[UserManagement]', ...args);
    }
  }
  
  // Get all users from the database
  getAllUsers() {
    const usersDB = JSON.parse(localStorage.getItem('contentGuardianUsersDB') || '[]');
    this.log(`getAllUsers: Found ${usersDB.length} users`);
    return usersDB;
  }
  
  // Get users by role
  getUsersByRole(role) {
    const users = this.getAllUsers();
    const filteredUsers = users.filter(user => user.role === role);
    this.log(`getUsersByRole(${role}): Found ${filteredUsers.length} users`);
    return filteredUsers;
  }
  
  // Get user by email
  getUserByEmail(email) {
    if (!email) {
      this.log('getUserByEmail: No email provided');
      return null;
    }
    
    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = email.toLowerCase();
    
    const users = this.getAllUsers();
    this.log(`getUserByEmail searching for: "${normalizedEmail}"`);
    this.log(`Available users: ${JSON.stringify(users.map(u => ({email: u.email, role: u.role})))}`);
    
    const user = users.find(user => user.email.toLowerCase() === normalizedEmail);
    this.log(`getUserByEmail(${email}): ${user ? 'Found user with role ' + user.role : 'User not found'}`);
    return user;
  }

  // Get user by ID
  getUserById(id) {
    const users = this.getAllUsers();
    return users.find(user => user.id === id);
  }
  
  // Create a new user
  createUser(userData) {
    if (!userData.email) {
      throw new Error('Email is required');
    }
    
    // Check if user already exists
    const existingUser = this.getUserByEmail(userData.email);
    if (existingUser) {
      this.log(`Email already registered: ${userData.email}`);
      throw new Error('Email already registered');
    }
    
    // Validate role
    if (!userData.role || (userData.role !== 'user' && userData.role !== 'guardian')) {
      this.log(`Invalid role: ${userData.role}, defaulting to 'user'`);
      userData.role = 'user';
    }
    
    this.log(`Creating user with role: ${userData.role}, email: ${userData.email}`);
    
    const usersDB = this.getAllUsers();
    
    // Create new user
    const newUser = {
      id: usersDB.length + 1,
      full_name: userData.full_name || 'Unknown',
      email: userData.email,
      password: userData.password || 'password123',
      role: userData.role,
      created_at: new Date().toISOString(),
      guardians_count: 0
    };
    
    // Add role-specific fields
    if (userData.role === 'user') {
      newUser.age = userData.age || null;
      // For users, we store verification emails
      if (userData.verification_emails && Array.isArray(userData.verification_emails)) {
        newUser.verification_emails = userData.verification_emails;
      }
    } else if (userData.role === 'guardian') {
      newUser.phone_number = userData.phone_number || null;
    }
    
    // Add user to database
    usersDB.push(newUser);
    localStorage.setItem('contentGuardianUsersDB', JSON.stringify(usersDB));
    
    this.log(`Created user: ${newUser.email} with role: ${newUser.role}`);
    return newUser;
  }
  
  // Get linked users for a guardian
  getLinkedUsers(guardianEmail) {
    this.log(`getLinkedUsers called with guardianEmail: "${guardianEmail}"`);
    
    if (!guardianEmail) {
      this.log('getLinkedUsers: No guardianEmail provided');
      return [];
    }
    
    // Get guardian
    const guardian = this.getUserByEmail(guardianEmail);
    if (!guardian) {
      this.log(`Guardian not found: ${guardianEmail}`);
      return [];
    }
    
    // Get relationships
    const relationshipsDB = JSON.parse(localStorage.getItem('contentGuardianRelationshipsDB') || '[]');
    const relationships = relationshipsDB.filter(r => 
      r.guardian_id === guardian.id && r.status === 'active'
    );
    
    this.log(`Found ${relationships.length} active relationships for guardian: ${guardianEmail}`);
    
    // Get user details
    const users = [];
    for (const relationship of relationships) {
      const user = this.getUserById(relationship.user_id);
      if (user) {
        users.push(user);
      }
    }
    
    this.log(`Returning ${users.length} linked users for guardian: ${guardianEmail}`);
    return users;
  }
  
  // Get linked guardians for a user
  getLinkedGuardians(userEmail) {
    if (!userEmail) {
      this.log('getLinkedGuardians: No userEmail provided');
      return [];
    }
    
    // Get user
    const user = this.getUserByEmail(userEmail);
    if (!user) {
      this.log(`User not found: ${userEmail}`);
      return [];
    }
    
    // Get relationships
    const relationshipsDB = JSON.parse(localStorage.getItem('contentGuardianRelationshipsDB') || '[]');
    const relationships = relationshipsDB.filter(r => 
      r.user_id === user.id && r.status === 'active'
    );
    
    this.log(`Found ${relationships.length} active relationships for user: ${userEmail}`);
    
    // Get guardian details
    const guardians = [];
    for (const relationship of relationships) {
      const guardian = this.getUserById(relationship.guardian_id);
      if (guardian) {
        guardians.push(guardian);
      }
    }
    
    this.log(`Returning ${guardians.length} linked guardians for user: ${userEmail}`);
    return guardians;
  }
  
  // Get pending link requests (for a user or guardian)
  getPendingRequests(email) {
    this.log(`getPendingRequests for: ${email}`);
    
    if (!email) {
      return [];
    }
    
    try {
      // Get the user to determine their role
      const user = this.getUserByEmail(email);
      if (!user) {
        return [];
      }
      
      // Check if we're looking for pending requests for a guardian or a user
      const isGuardian = user.role === 'guardian';
      
      // Get relationships database
      const relationshipsDB = JSON.parse(localStorage.getItem('contentGuardianRelationshipsDB') || '[]');
      
      // Filter pending relationships
      const pendingRelationships = relationshipsDB.filter(r => {
        if (isGuardian) {
          // For guardians, find user requests that need guardian approval
          return r.status === 'pending' && this.getUserById(r.guardian_id)?.email.toLowerCase() === email.toLowerCase();
        } else {
          // For users, find guardian requests that need user approval
          return r.status === 'pending' && this.getUserById(r.user_id)?.email.toLowerCase() === email.toLowerCase();
        }
      });
      
      this.log(`Found ${pendingRelationships.length} pending requests for ${email}`);
      
      // Convert to the format expected by the UI
      return pendingRelationships.map(r => {
        const otherPerson = isGuardian 
          ? this.getUserById(r.user_id) 
          : this.getUserById(r.guardian_id);
          
        return {
          id: r.id,
          userEmail: isGuardian ? otherPerson.email : email,
          guardianEmail: isGuardian ? email : otherPerson.email,
          timestamp: r.created_at
        };
      });
    } catch (error) {
      this.log('Error getting pending requests:', error);
      return [];
    }
  }
  
  // Link a user to a guardian (creates an active relationship)
  linkUser(guardianEmail, userEmail) {
    this.log(`linkUser: Linking guardian ${guardianEmail} to user ${userEmail}`);
    
    // Get users
    const guardian = this.getUserByEmail(guardianEmail);
    const user = this.getUserByEmail(userEmail);
    
    // Log detailed information about found users
    this.log(`Guardian lookup result: ${JSON.stringify(guardian ? {id: guardian.id, email: guardian.email, role: guardian.role} : null)}`);
    this.log(`User lookup result: ${JSON.stringify(user ? {id: user.id, email: user.email, role: user.role} : null)}`);
    
    // Validate users
    if (!guardian) {
      const error = `Guardian account not found with email: ${guardianEmail}`;
      this.log(error);
      throw new Error(error);
    }
    
    if (guardian.role !== 'guardian') {
      const error = `Account ${guardianEmail} exists but has role "${guardian.role}" instead of "guardian"`;
      this.log(error);
      throw new Error(error);
    }
    
    if (!user) {
      const error = `User account not found with email: ${userEmail}`;
      this.log(error);
      throw new Error(error);
    }
    
    if (user.role !== 'user') {
      const error = `Account ${userEmail} exists but has role "${user.role}" instead of "user"`;
      this.log(error); 
      throw new Error(error);
    }
    
    // Check if already linked
    const relationshipsDB = JSON.parse(localStorage.getItem('contentGuardianRelationshipsDB') || '[]');
    const existingRelationship = relationshipsDB.find(r => 
      r.guardian_id === guardian.id && r.user_id === user.id
    );
    
    if (existingRelationship) {
      // If inactive or pending, reactivate it
      if (existingRelationship.status !== 'active') {
        existingRelationship.status = 'active';
        localStorage.setItem('contentGuardianRelationshipsDB', JSON.stringify(relationshipsDB));
        
        // Update guardian count
        this.updateGuardianCount(user.id);
        
        this.log(`Reactivated relationship: ${guardianEmail} -> ${userEmail}`);
        return true;
      }
      
      this.log(`Users are already linked: ${guardianEmail} -> ${userEmail}`);
      return false;
    }
    
    // Create new relationship
    const newRelationship = {
      id: relationshipsDB.length + 1,
      guardian_id: guardian.id,
      user_id: user.id,
      status: 'active',
      created_at: new Date().toISOString()
    };
    
    relationshipsDB.push(newRelationship);
    localStorage.setItem('contentGuardianRelationshipsDB', JSON.stringify(relationshipsDB));
    
    // Update guardian count
    const newCount = this.updateGuardianCount(user.id);
    this.log(`Updated guardian count for ${userEmail}: ${newCount}`);
    
    this.log(`Created relationship: ${guardianEmail} -> ${userEmail}`);
    return true;
  }
  
  // Unlink a user from a guardian
  unlinkUser(guardianEmail, userEmail) {
    this.log(`unlinkUser: Unlinking user ${userEmail} from guardian ${guardianEmail}`);
    
    // Get users
    const guardian = this.getUserByEmail(guardianEmail);
    const user = this.getUserByEmail(userEmail);
    
    if (!guardian || !user) {
      this.log('Guardian or user not found');
      return false;
    }
    
    // Find relationship
    const relationshipsDB = JSON.parse(localStorage.getItem('contentGuardianRelationshipsDB') || '[]');
    const relationshipIndex = relationshipsDB.findIndex(r => 
      r.guardian_id === guardian.id && r.user_id === user.id && r.status === 'active'
    );
    
    if (relationshipIndex === -1) {
      this.log('No active relationship found');
      return false;
    }
    
    // Deactivate the relationship
    relationshipsDB[relationshipIndex].status = 'inactive';
    localStorage.setItem('contentGuardianRelationshipsDB', JSON.stringify(relationshipsDB));
    
    // Update guardian count
    this.updateGuardianCount(user.id);
    
    this.log(`Deactivated relationship: ${guardianEmail} -> ${userEmail}`);
    return true;
  }
  
  // Accept a link request (compatibility method)
  acceptRequest(guardianEmail, userEmail) {
    this.log(`acceptRequest from ${guardianEmail} to ${userEmail}`);
    
    try {
      // Get users
      const guardian = this.getUserByEmail(guardianEmail);
      const user = this.getUserByEmail(userEmail);
      
      if (!guardian || !user) {
        throw new Error('Guardian or user not found');
      }
      
      // Get relationships
      const relationshipsDB = JSON.parse(localStorage.getItem('contentGuardianRelationshipsDB') || '[]');
      
      // Find the pending relationship
      const relationshipIndex = relationshipsDB.findIndex(r => 
        r.guardian_id === guardian.id && 
        r.user_id === user.id && 
        r.status === 'pending'
      );
      
      if (relationshipIndex === -1) {
        throw new Error('No pending relationship found');
      }
      
      // Update the relationship to active
      relationshipsDB[relationshipIndex].status = 'active';
      localStorage.setItem('contentGuardianRelationshipsDB', JSON.stringify(relationshipsDB));
      
      // Update guardian count
      this.updateGuardianCount(user.id);
      
      this.log(`Accepted relationship: ${guardianEmail} -> ${userEmail}`);
      return true;
    } catch (error) {
      this.log('Error accepting request:', error);
      throw error;
    }
  }
  
  // Reject a link request (compatibility method)
  rejectRequest(guardianEmail, userEmail) {
    this.log(`rejectRequest from ${guardianEmail} to ${userEmail}`);
    
    try {
      // Get users
      const guardian = this.getUserByEmail(guardianEmail);
      const user = this.getUserByEmail(userEmail);
      
      if (!guardian || !user) {
        throw new Error('Guardian or user not found');
      }
      
      // Get relationships
      const relationshipsDB = JSON.parse(localStorage.getItem('contentGuardianRelationshipsDB') || '[]');
      
      // Find the pending relationship
      const relationshipIndex = relationshipsDB.findIndex(r => 
        r.guardian_id === guardian.id && 
        r.user_id === user.id && 
        r.status === 'pending'
      );
      
      if (relationshipIndex === -1) {
        throw new Error('No pending relationship found');
      }
      
      // Remove the relationship
      relationshipsDB.splice(relationshipIndex, 1);
      localStorage.setItem('contentGuardianRelationshipsDB', JSON.stringify(relationshipsDB));
      
      this.log(`Rejected relationship: ${guardianEmail} -> ${userEmail}`);
      return true;
    } catch (error) {
      this.log('Error rejecting request:', error);
      throw error;
    }
  }
  
  // Request to link with a guardian (compatibility method)
  requestLink(userEmail, guardianEmail) {
    this.log(`requestLink from user ${userEmail} to guardian ${guardianEmail}`);
    
    try {
      // Get users
      const user = this.getUserByEmail(userEmail);
      const guardian = this.getUserByEmail(guardianEmail);
      
      if (!user || !guardian) {
        throw new Error('User or guardian not found');
      }
      
      if (user.role !== 'user') {
        throw new Error('Only regular users can request guardian links');
      }
      
      if (guardian.role !== 'guardian') {
        throw new Error('Can only link to guardian accounts');
      }
      
      // Check if there's already a relationship
      const relationshipsDB = JSON.parse(localStorage.getItem('contentGuardianRelationshipsDB') || '[]');
      
      // Find any existing relationship
      const existingRelationship = relationshipsDB.find(r => 
        r.guardian_id === guardian.id && r.user_id === user.id
      );
      
      if (existingRelationship) {
        if (existingRelationship.status === 'active') {
          throw new Error('Already linked to this guardian');
        } else if (existingRelationship.status === 'pending') {
          throw new Error('Link request already pending');
        } else {
          // Reactivate as pending
          existingRelationship.status = 'pending';
          existingRelationship.created_at = new Date().toISOString();
          localStorage.setItem('contentGuardianRelationshipsDB', JSON.stringify(relationshipsDB));
          this.log(`Reactivated pending link request: ${userEmail} -> ${guardianEmail}`);
          return true;
        }
      }
      
      // Create a new pending relationship
      const newRelationship = {
        id: relationshipsDB.length + 1,
        guardian_id: guardian.id,
        user_id: user.id,
        status: 'pending',
        created_at: new Date().toISOString()
      };
      
      relationshipsDB.push(newRelationship);
      localStorage.setItem('contentGuardianRelationshipsDB', JSON.stringify(relationshipsDB));
      
      this.log(`Created pending link request: ${userEmail} -> ${guardianEmail}`);
      return true;
    } catch (error) {
      this.log('Error creating link request:', error);
      throw error;
    }
  }
  
  // Ensure demo users exist for testing
  ensureDemoUsers() {
    this.log('Ensuring demo users exist...');
    
    // Get all users from our internal database
    const usersDB = this.getAllUsers();
    let changes = false;
    let demoGuardian = null;
    let demoUser = null;
    
    // Check for existing guardian in the database
    demoGuardian = usersDB.find(u => u.role === 'guardian');
    
    // Create a guardian if none exists
    if (!demoGuardian) {
      this.log('No guardian found, creating demo guardian');
      try {
        demoGuardian = this.createUser({
          full_name: 'Demo Guardian',
          email: 'guardian@example.com',
          password: 'password123',
          role: 'guardian',
          phone_number: '555-123-4567'
        });
        this.log('Successfully created demo guardian');
        changes = true;
      } catch (error) {
        this.log(`Error creating demo guardian: ${error.message}`);
      }
    } else {
      this.log(`Found existing guardian: ${demoGuardian.email} with role: ${demoGuardian.role}`);
    }
    
    // Check for existing user in the database
    demoUser = usersDB.find(u => u.role === 'user');
    
    // Create a user if none exists
    if (!demoUser) {
      this.log('No user found, creating demo user');
      try {
        demoUser = this.createUser({
          full_name: 'Demo User',
          email: 'user@example.com',
          password: 'password123',
          role: 'user',
          age: 15,
          verification_emails: ['user@example.com']
        });
        this.log('Successfully created demo user');
        changes = true;
      } catch (error) {
        this.log(`Error creating demo user: ${error.message}`);
      }
    } else {
      this.log(`Found existing user: ${demoUser.email} with role: ${demoUser.role}`);
    }
    
    // Ensure the users are in the 'contentGuardianUsers' for login functionality
    const loginUsers = JSON.parse(localStorage.getItem('contentGuardianUsers') || '[]');
    
    // Add guardian to login users if not already present and if demo guardian was created
    if (demoGuardian && !loginUsers.some(u => u.email.toLowerCase() === demoGuardian.email.toLowerCase())) {
      this.log('Adding demo guardian to login users');
      loginUsers.push({
        full_name: demoGuardian.full_name,
        email: demoGuardian.email,
        password: 'password123',
        role: 'guardian'
      });
      changes = true;
    }
    
    // Add user to login users if not already present and if demo user was created
    if (demoUser && !loginUsers.some(u => u.email.toLowerCase() === demoUser.email.toLowerCase())) {
      this.log('Adding demo user to login users');
      loginUsers.push({
        full_name: demoUser.full_name,
        email: demoUser.email,
        password: 'password123',
        role: 'user',
        verification_emails: ['user@example.com']
      });
      changes = true;
    }
    
    // Save updated login users
    if (changes) {
      localStorage.setItem('contentGuardianUsers', JSON.stringify(loginUsers));
      this.log('Updated contentGuardianUsers with demo accounts');
    }
    
    // Try to link the users if they exist
    try {
      if (demoGuardian && demoUser) {
        this.log('Checking demo users link status');
        // Get linked users for the demo guardian
        const linkedUsers = this.getLinkedUsers(demoGuardian.email);
        if (!linkedUsers.some(u => u.email.toLowerCase() === demoUser.email.toLowerCase())) {
          this.log('Linking demo guardian to demo user');
          this.linkUser(demoGuardian.email, demoUser.email);
          changes = true;
        } else {
          this.log('Demo users already linked');
        }
      }
    } catch (e) {
      this.log('Error linking demo users:', e);
    }
    
    return changes;
  }
}

// Create the global instance
window.userManagement = new UserManagement(); 