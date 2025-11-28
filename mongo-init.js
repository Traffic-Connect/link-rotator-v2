// MongoDB initialization script
db = db.getSiblingDB('link_rotator');

// Создаем индексы для оптимизации
db.links.createIndex({ "key": 1 }, { unique: true });
db.links.createIndex({ "userId": 1, "createdAt": -1 });
db.links.createIndex({ "userId": 1, "isActive": 1 });

db.clicks.createIndex({ "linkId": 1, "createdAt": -1 });
db.clicks.createIndex({ "redirectId": 1, "createdAt": -1 });
db.clicks.createIndex({ "createdAt": -1 });

db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "isActive": 1 });

print("MongoDB indexes created");

// Создаем администратора
// ВАЖНО: Пароль будет захеширован при первом входе через API
// Здесь мы создаем временную запись, которую нужно будет обновить
const adminEmail = "adminseo@trafficconnect.com";

// Проверяем, существует ли уже администратор
const existingAdmin = db.users.findOne({ email: adminEmail });

if (!existingAdmin) {
    // Bcrypt hash для пароля "m9OviUHdCOKM" (10 rounds)
    // Сгенерирован заранее: bcrypt.hashSync('m9OviUHdCOKM', 10)
    const hashedPassword = "$2a$10$5YJqE3xHKvN3oPYLmP0JbeQwKjF0tM0C3Z8EJYVz5LKFVNqXZm7Wy";

    db.users.insertOne({
        name: "Admin SEO",
        email: adminEmail,
        password: hashedPassword,
        role: "admin",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLogin: null
    });

    print("✅ Admin user created:");
    print("   Email: " + adminEmail);
    print("   Password: m9OviUHdCOKM");
    print("   Role: admin");
} else {
    print("ℹ️  Admin user already exists, skipping creation");
}

print("MongoDB initialization completed successfully");