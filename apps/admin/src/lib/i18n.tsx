"use client";

import * as React from "react";

export type AdminLanguage = "az" | "ru" | "en";

const STORAGE_KEY = "linkfit_admin_language";

const LABELS: Record<AdminLanguage, string> = {
  az: "AZ",
  ru: "RU",
  en: "EN",
};

const NAMES: Record<AdminLanguage, string> = {
  az: "Azərbaycan",
  ru: "Русский",
  en: "English",
};

const RU: Record<string, string> = {
  "Admin": "Админ",
  "Admin panel": "Панель администратора",
  "Sign in": "Войти",
  "Use your Linkfit admin account to continue.": "Войдите в аккаунт администратора Linkfit.",
  "Email": "Email",
  "Password": "Пароль",
  "Enter a valid email": "Введите корректный email",
  "Password is required": "Введите пароль",
  "This account does not have admin access.": "У этого аккаунта нет доступа администратора.",
  "Incorrect email or password.": "Неверный email или пароль.",
  "Sign in failed.": "Не удалось войти.",
  "Sign in failed. Try again.": "Не удалось войти. Попробуйте снова.",
  "Signing in…": "Вход…",
  "Need access? Ask an existing admin to provision your account.": "Нужен доступ? Попросите действующего администратора выдать аккаунт.",
  "Signed in as": "Вы вошли как",
  "Loading…": "Загрузка…",
  "Sign out": "Выйти",
  "Overview": "Обзор",
  "Users": "Пользователи",
  "Games": "Игры",
  "Tournaments": "Турниры",
  "Bookings": "Бронирования",
  "Reports": "Жалобы",
  "Audit": "Аудит",
  "High-level activity across LinkFit.": "Ключевая активность LinkFit.",
  "Refresh": "Обновить",
  "Failed to load admin stats": "Не удалось загрузить статистику",
  "Check your connection and try again.": "Проверьте соединение и попробуйте снова.",
  "Retry": "Повторить",
  "Total users": "Всего пользователей",
  "All registered accounts": "Все зарегистрированные аккаунты",
  "New this week": "Новые за неделю",
  "Sign-ups in the last 7 days": "Регистрации за последние 7 дней",
  "Games this week": "Игры за неделю",
  "Scheduled in the last 7 days": "Запланировано за последние 7 дней",
  "Games completed": "Завершённые игры",
  "All-time finished games": "Все завершённые игры",
  "Top venues": "Лучшие площадки",
  "Venues hosting the most games right now.": "Площадки с наибольшим количеством игр.",
  "Venue": "Площадка",
  "Venue & Court": "Площадка и корт",
  "No venue activity yet.": "Активности по площадкам пока нет.",
  "Pending reports": "Ожидающие жалобы",
  "Moderation queue awaiting review.": "Очередь модерации ожидает проверки.",
  "Awaiting moderator action": "Ожидает действий модератора",
  "All clear": "Всё чисто",
  "Review queue": "Открыть очередь",
  "Rezervasiyalar": "Бронирования",
  "Booking əməliyyatları": "Операции бронирований",
  "Kort rezervasiyaları, ödəniş, refund və giriş qeydiyyatı.": "Бронирования кортов, оплата, возвраты и check-in.",
  "Yenilə": "Обновить",
  "Manual booking": "Ручное бронирование",
  "Ümumi": "Всего",
  "Gələcək": "Будущие",
  "Gəlir": "Доход",
  "Ödəniş gözləyir": "Ожидает оплаты",
  "Bağlanıb": "Закрыто",
  "Check-in / No-show": "Check-in / No-show",
  "Müştəri, email, məkan və ya kort üzrə axtar...": "Поиск по клиенту, email, площадке или корту...",
  "Bütün məkanlar": "Все площадки",
  "Bütün kortlar": "Все корты",
  "Hamısı": "Все",
  "Qismən ödənib": "Частично оплачено",
  "Ödənib": "Оплачено",
  "Ləğv edilib": "Отменено",
  "Refund edilib": "Возврат выполнен",
  "Uğursuz": "Ошибка",
  "Filterləri sıfırla": "Сбросить фильтры",
  "rezervasiya seçilib": "бронирований выбрано",
  "Seçilən rezervasiyalar ödənişli edildi": "Выбранные бронирования отмечены оплаченными",
  "Ödənib et": "Отметить оплаченным",
  "Seçilən rezervasiyalar ləğv edildi": "Выбранные бронирования отменены",
  "Ləğv et": "Отменить",
  "Seçimi təmizlə": "Очистить выбор",
  "Rezervasiya siyahısı": "Список бронирований",
  "göstərilir": "показано",
  "Rezervasiya tapılmadı": "Бронирования не найдены",
  "Filterləri dəyişərək yenidən yoxlayın.": "Измените фильтры и попробуйте снова.",
  "Müştəri": "Клиент",
  "Məkan və kort": "Площадка и корт",
  "Vaxt": "Время",
  "Ödəniş": "Оплата",
  "Status": "Статус",
  "Giriş": "Вход",
  "Əməliyyat": "Действие",
  "Email yoxdur": "Email отсутствует",
  "Adsız müştəri": "Клиент без имени",
  "Qeyd yoxdur": "Нет записи",
  "Gözləyir": "Ожидает",
  "Detal": "Детали",
  "Edit": "Редактировать",
  "Check-in geri al": "Отменить check-in",
  "No-show sil": "Убрать no-show",
  "Rezervasiya detalları": "Детали бронирования",
  "Məkan": "Площадка",
  "Məbləğ": "Сумма",
  "Mənbə": "Источник",
  "Yaradılıb": "Создано",
  "Ləğv": "Отмена",
  "Daxili qeyd": "Внутренняя заметка",
  "Rezervasiyanı redaktə et": "Редактировать бронирование",
  "Başlama vaxtı": "Время начала",
  "Müddət": "Длительность",
  "Ödəniş metodu": "Способ оплаты",
  "Müştəri adı": "Имя клиента",
  "Müştəri email": "Email клиента",
  "Ödəniş qeydi": "Заметка по оплате",
  "Bağla": "Закрыть",
  "Yadda saxla": "Сохранить",
  "Rezervasiyanı ləğv et": "Отменить бронирование",
  "Ləğv səbəbi": "Причина отмены",
  "Səbəb qeyd et": "Укажите причину",
  "Refund status": "Статус возврата",
  "Refund məbləği": "Сумма возврата",
  "Refund qeydi": "Заметка по возврату",
  "Refund idarəsi": "Управление возвратом",
  "Qeyd": "Заметка",
  "Manual booking yarat": "Создать ручное бронирование",
  "Məkan seç": "Выберите площадку",
  "Kort": "Корт",
  "Kort seç": "Выберите корт",
  "Slot mövcuddur": "Слот доступен",
  "Slot yoxlanmadı": "Не удалось проверить слот",
  "Kort və vaxt seçilməlidir": "Выберите корт и время",
  "Booking yaradılmadı": "Бронирование не создано",
  "Manual booking yaradıldı": "Ручное бронирование создано",
  "Yoxla": "Проверить",
  "Yarat": "Создать",
  "Slot açıqdır": "Слот доступен",
  "bitiş": "конец",
  "Əməliyyat alınmadı": "Операция не выполнена",
  "Yenidən yoxlayın": "Попробуйте снова",
  "Export hazırdır": "Экспорт готов",
  "Export alınmadı": "Экспорт не выполнен",
  "Export faylı yaradılmadı": "Файл экспорта не создан",
  "Rezervasiya ödənildi": "Бронирование оплачено",
  "Check-in qeyd edildi": "Check-in отмечен",
  "Check-in geri alındı": "Check-in отменён",
  "No-show qeyd edildi": "No-show отмечен",
  "No-show silindi": "No-show удалён",
  "Rezervasiya ləğv edildi": "Бронирование отменено",
  "Refund məlumatı yeniləndi": "Данные возврата обновлены",
  "Rezervasiya yeniləndi": "Бронирование обновлено",
  "Yeniləmə alınmadı": "Не удалось обновить",
  "Nağd": "Наличные",
  "Bank köçürməsi": "Банковский перевод",
  "Məkanda": "На месте",
  "Yoxlama gözləyir": "Ожидает проверки",
  "Təsdiqlənib": "Подтверждено",
  "İcra olunub": "Выполнено",
  "Rədd edilib": "Отклонено",
  "Lazım deyil": "Не требуется",
  "Oyun siyahısı": "Список игр",
  "Oyun yoxdur": "Игр нет",
  "oyun": "игр",
  "yenilənir": "обновляется",
  "Açıq": "Открыто",
  "Dolu": "Заполнено",
  "Bitib": "Завершено",
  "Bütün tarixlər": "Все даты",
  "Bu həftə": "Эта неделя",
  "Növbəti 30 gün": "Следующие 30 дней",
  "Son 30 gün": "Последние 30 дней",
  "Tarix": "Дата",
  "Sıfırla": "Сбросить",
  "Host və ya məkan üzrə axtar": "Поиск по хосту или площадке",
  "Oyun": "Игра",
  "Tutum": "Вместимость",
  "Səhifə": "Страница",
  "Əvvəlki": "Назад",
  "Növbəti": "Далее",
  "İstifadəçi": "Пользователь",
  "Aktivlik": "Активность",
  "Rol": "Роль",
  "Ad və ya e-poçt ilə axtar": "Поиск по имени или email",
  "İstifadəçi axtarışı": "Поиск пользователей",
  "Yenilənir": "Обновляется",
  "Bütün statuslar": "Все статусы",
  "Aktiv": "Активен",
  "Bloklanıb": "Заблокирован",
  "Silinib": "Удалён",
  "Təsdiqli": "Подтверждён",
  "Təsdiqsiz": "Не подтверждён",
  "Standart": "Стандарт",
  "Cəmi": "Всего",
  "Blok": "Блок",
  "Email təsdiqli": "Email подтверждён",
  "Göstərilir": "Показано",
  "Rol yeniləndi": "Роль обновлена",
  "Rol yenilənmədi": "Роль не обновлена",
  "Email statusu yeniləndi": "Статус email обновлён",
  "Email statusu yenilənmədi": "Статус email не обновлён",
  "VIP badge yeniləndi": "VIP бейдж обновлён",
  "VIP badge yenilənmədi": "VIP бейдж не обновлён",
  "İstifadəçi bloklandı": "Пользователь заблокирован",
  "Bloklama alınmadı": "Блокировка не выполнена",
  "Blok aradan qaldırıldı": "Блокировка снята",
  "Blok aradan qaldırılmadı": "Блокировка не снята",
  "İstifadəçi silindi": "Пользователь удалён",
  "İstifadəçi silinmədi": "Пользователь не удалён",
  "İstifadəçi bərpa edildi": "Пользователь восстановлен",
  "Bərpa alınmadı": "Восстановление не выполнено",
  "Blok səbəbi yazılmalıdır": "Укажите причину блокировки",
  "Venues": "Площадки",
  "Manage partner venues, locations, courts and hero imagery.": "Управляйте партнёрскими площадками, локациями, кортами и изображениями.",
  "New venue": "Новая площадка",
  "Search by name or address…": "Поиск по названию или адресу…",
  "No venues yet": "Площадок пока нет",
  "Add your first venue to start listing courts and accepting bookings.": "Добавьте первую площадку, чтобы публиковать корты и принимать бронирования.",
  "Add your first venue": "Добавить первую площадку",
  "Edit venue": "Редактировать площадку",
  "Update venue details, photo or partner status.": "Обновите данные площадки, фото или партнёрский статус.",
  "Create a venue. You can add courts after saving.": "Создайте площадку. Корты можно добавить после сохранения.",
  "Delete venue": "Удалить площадку",
  "Cancel": "Отмена",
  "Delete": "Удалить",
  "Deleting...": "Удаление...",
  "Venue updated": "Площадка обновлена",
  "Venue created": "Площадка создана",
  "Venue deleted": "Площадка удалена",
  "Save failed": "Не удалось сохранить",
  "Delete failed": "Не удалось удалить",
};

const EN: Record<string, string> = {
  "Admin panel": "Admin panel",
  "Rezervasiyalar": "Bookings",
  "Booking əməliyyatları": "Booking operations",
  "Kort rezervasiyaları, ödəniş, refund və giriş qeydiyyatı.": "Court bookings, payments, refunds and check-ins.",
  "Yenilə": "Refresh",
  "Ümumi": "Total",
  "Gələcək": "Upcoming",
  "Gəlir": "Revenue",
  "Ödəniş gözləyir": "Pending payment",
  "Bağlanıb": "Closed",
  "Müştəri, email, məkan və ya kort üzrə axtar...": "Search by customer, email, venue or court...",
  "Bütün məkanlar": "All venues",
  "Bütün kortlar": "All courts",
  "Hamısı": "All",
  "Qismən ödənib": "Partially paid",
  "Ödənib": "Paid",
  "Ləğv edilib": "Cancelled",
  "Refund edilib": "Refunded",
  "Uğursuz": "Failed",
  "Filterləri sıfırla": "Reset filters",
  "Seçilən rezervasiyalar ödənişli edildi": "Selected bookings marked as paid",
  "Ödənib et": "Mark paid",
  "Seçilən rezervasiyalar ləğv edildi": "Selected bookings cancelled",
  "Ləğv et": "Cancel",
  "Seçimi təmizlə": "Clear selection",
  "Rezervasiya siyahısı": "Booking list",
  "göstərilir": "shown",
  "Rezervasiya tapılmadı": "No bookings found",
  "Filterləri dəyişərək yenidən yoxlayın.": "Change filters and try again.",
  "Müştəri": "Customer",
  "Məkan və kort": "Venue and court",
  "Vaxt": "Time",
  "Ödəniş": "Payment",
  "Giriş": "Entry",
  "Əməliyyat": "Action",
  "Email yoxdur": "No email",
  "Adsız müştəri": "Unnamed customer",
  "Qeyd yoxdur": "No note",
  "Gözləyir": "Waiting",
  "Detal": "Details",
  "Ləğv": "Cancel",
  "Məkan": "Venue",
  "Məbləğ": "Amount",
  "Mənbə": "Source",
  "Yaradılıb": "Created",
  "Daxili qeyd": "Internal note",
  "Başlama vaxtı": "Start time",
  "Müddət": "Duration",
  "Ödəniş metodu": "Payment method",
  "Müştəri adı": "Customer name",
  "Müştəri email": "Customer email",
  "Ödəniş qeydi": "Payment note",
  "Bağla": "Close",
  "Yadda saxla": "Save",
  "Ləğv səbəbi": "Cancellation reason",
  "Səbəb qeyd et": "Add a reason",
  "Refund məbləği": "Refund amount",
  "Refund qeydi": "Refund note",
  "Qeyd": "Note",
  "Yoxla": "Check",
  "Yarat": "Create",
  "Əməliyyat alınmadı": "Operation failed",
  "Yenidən yoxlayın": "Try again",
  "Nağd": "Cash",
  "Bank köçürməsi": "Bank transfer",
  "Məkanda": "On-site",
  "Yoxlama gözləyir": "Pending review",
  "Təsdiqlənib": "Approved",
  "İcra olunub": "Processed",
  "Rədd edilib": "Rejected",
  "Lazım deyil": "Not required",
  "Oyun siyahısı": "Game list",
  "Oyun yoxdur": "No games",
  "oyun": "games",
  "yenilənir": "refreshing",
  "Açıq": "Open",
  "Dolu": "Full",
  "Bitib": "Completed",
  "Bütün tarixlər": "All dates",
  "Bu həftə": "This week",
  "Növbəti 30 gün": "Next 30 days",
  "Son 30 gün": "Last 30 days",
  "Tarix": "Date",
  "Sıfırla": "Reset",
  "Host və ya məkan üzrə axtar": "Search by host or venue",
  "Oyun": "Game",
  "Tutum": "Capacity",
  "Səhifə": "Page",
  "Əvvəlki": "Previous",
  "Növbəti": "Next",
  "İstifadəçi": "User",
  "Aktivlik": "Activity",
  "Rol": "Role",
  "Ad və ya e-poçt ilə axtar": "Search by name or email",
  "İstifadəçi axtarışı": "User search",
  "Yenilənir": "Refreshing",
  "Bütün statuslar": "All statuses",
  "Aktiv": "Active",
  "Bloklanıb": "Suspended",
  "Silinib": "Deleted",
  "Təsdiqli": "Verified",
  "Təsdiqsiz": "Unverified",
  "Standart": "Standard",
  "Cəmi": "Total",
  "Blok": "Blocked",
  "Email təsdiqli": "Email verified",
  "Göstərilir": "Showing",
  "Rol yeniləndi": "Role updated",
  "Rol yenilənmədi": "Role was not updated",
  "Email statusu yeniləndi": "Email status updated",
  "Email statusu yenilənmədi": "Email status was not updated",
  "VIP badge yeniləndi": "VIP badge updated",
  "VIP badge yenilənmədi": "VIP badge was not updated",
  "İstifadəçi bloklandı": "User suspended",
  "Bloklama alınmadı": "Suspend failed",
  "Blok aradan qaldırıldı": "Suspension removed",
  "Blok aradan qaldırılmadı": "Suspension was not removed",
  "İstifadəçi silindi": "User deleted",
  "İstifadəçi silinmədi": "User was not deleted",
  "İstifadəçi bərpa edildi": "User restored",
  "Bərpa alınmadı": "Restore failed",
  "Blok səbəbi yazılmalıdır": "Suspension reason is required",
};

Object.assign(RU, {
  "Platforma nəzarəti bir yerdə.": "Контроль платформы в одном месте.",
  "İstifadəçilər, məkanlar, courtlar, oyunlar və rezervasiyalar üçün Linkfit idarəetməsi.": "Управление Linkfit для пользователей, площадок, кортов, игр и бронирований.",
  "rezervasiya seçilib": "выбрано",
  "Adsız istifadəçi": "Пользователь без имени",
  "Detallara bax": "Посмотреть детали",
  "Email təsdiqini sil": "Снять подтверждение email",
  "Email təsdiqlə": "Подтвердить email",
  "VIP badge sil": "Удалить VIP бейдж",
  "VIP badge ver": "Выдать VIP бейдж",
  "Admin et": "Сделать админом",
  "Moderator et": "Сделать модератором",
  "Adi istifadəçi et": "Сделать обычным пользователем",
  "Bloku aç": "Снять блокировку",
  "Blokla": "Заблокировать",
  "Bərpa et": "Восстановить",
  "İstifadəçini sil?": "Удалить пользователя?",
  "hesabı soft-delete olunacaq. Sonradan bərpa edilə bilər.": "будет soft-deleted. Его можно восстановить позже.",
  "İstifadəçini blokla": "Заблокировать пользователя",
  "Blok səbəbi audit log-da saxlanacaq və admin komandası üçün görünəcək.": "Причина блокировки сохранится в audit log и будет видна команде админов.",
  "Səbəb": "Причина",
  "Məsələn: qayda pozuntusu, spam, ödəniş problemi...": "Например: нарушение правил, спам, проблема с оплатой...",
  "Badge istifadəçi profilində və admin listində görünəcək.": "Бейдж будет виден в профиле пользователя и списке админки.",
  "Badge adı": "Название бейджа",
  "Bitmə tarixi": "Дата окончания",
  "İstifadəçi profili": "Профиль пользователя",
  "Hesab statusu, activity və admin qərarları üçün qısa icmal.": "Краткий обзор статуса аккаунта, активности и админ-решений.",
  "Məlumat yüklənmədi.": "Данные не загрузились.",
  "Oyun ləğv edildi": "Игра отменена",
  "İştirakçılar bildiriş alacaq.": "Участники получат уведомление.",
  "Ləğv alınmadı": "Не удалось отменить",
  "Oyun silindi": "Игра удалена",
  "Oyun siyahılardan gizlədildi.": "Игра скрыта из списков.",
  "Silmək alınmadı": "Не удалось удалить",
  "Sərbəst lokasiya": "Свободная локация",
  "Bax": "Открыть",
  "Oyunu ləğv et": "Отменить игру",
  "Yalnız açıq/dolu oyun ləğv edilə bilər": "Можно отменить только открытую/заполненную игру",
  "Oyunu sil": "Удалить игру",
  "Yalnız ləğv/bitmiş oyun silinə bilər": "Можно удалить только отменённую/завершённую игру",
  "Oyunu ləğv et?": "Отменить игру?",
  "tərəfindən yaradılmış": "создал(а)",
  "oyunu ləğv olunacaq.": "игра будет отменена.",
  "Məsələn: məkan texniki səbəbə görə bağlıdır": "Например: площадка закрыта по технической причине",
  "Geri": "Назад",
  "Ləğv edilir": "Отменяется",
  "Oyunu sil?": "Удалить игру?",
  "Oyun default siyahılardan gizlənəcək, audit və database qeydi saxlanacaq.": "Игра будет скрыта из списков, audit и запись в базе сохранятся.",
  "Silinir": "Удаляется",
  "Oyun tapılmadı": "Игры не найдены",
  "Filterləri dəyişin və ya yeni oyunlar yaradıldıqda burada görünəcək.": "Измените фильтры или дождитесь новых игр.",
  "Oyunlar yüklənmədi": "Игры не загрузились",
  "API bağlantısını və admin sessiyasını yoxlayın.": "Проверьте API-соединение и админ-сессию.",
  "Yenidən cəhd et": "Попробовать снова",
  "No venues match": "Площадки не найдены по запросу",
  "Are you sure you want to delete": "Вы уверены, что хотите удалить",
  "This action cannot be undone, and the venue must not have any future bookings.": "Это действие нельзя отменить, и у площадки не должно быть будущих бронирований.",
  "Could not save venue": "Не удалось сохранить площадку",
  "Could not delete venue": "Не удалось удалить площадку",
});

Object.assign(EN, {
  "Sign in": "Sign in",
  "Use your Linkfit admin account to continue.": "Use your Linkfit admin account to continue.",
  "Email": "Email",
  "Password": "Password",
  "Enter a valid email": "Enter a valid email",
  "Password is required": "Password is required",
  "This account does not have admin access.": "This account does not have admin access.",
  "Incorrect email or password.": "Incorrect email or password.",
  "Sign in failed.": "Sign in failed.",
  "Sign in failed. Try again.": "Sign in failed. Try again.",
  "Signing in…": "Signing in...",
  "Need access? Ask an existing admin to provision your account.": "Need access? Ask an existing admin to provision your account.",
  "Platforma nəzarəti bir yerdə.": "Platform control in one place.",
  "İstifadəçilər, məkanlar, courtlar, oyunlar və rezervasiyalar üçün Linkfit idarəetməsi.": "Linkfit management for users, venues, courts, games and bookings.",
  "rezervasiya seçilib": "bookings selected",
  "Rezervasiya ödənildi": "Booking marked as paid",
  "Check-in qeyd edildi": "Check-in recorded",
  "Check-in geri alındı": "Check-in undone",
  "No-show qeyd edildi": "No-show recorded",
  "No-show silindi": "No-show cleared",
  "Rezervasiya ləğv edildi": "Booking cancelled",
  "Refund məlumatı yeniləndi": "Refund information updated",
  "Rezervasiya yeniləndi": "Booking updated",
  "Yeniləmə alınmadı": "Update failed",
  "Export hazırdır": "Export is ready",
  "Export alınmadı": "Export failed",
  "Export faylı yaradılmadı": "Export file was not created",
  "Slot mövcuddur": "Slot is available",
  "Slot yoxlanmadı": "Slot check failed",
  "Kort və vaxt seçilməlidir": "Court and time are required",
  "Booking yaradılmadı": "Booking was not created",
  "Manual booking yaradıldı": "Manual booking created",
  "Manual booking yarat": "Create manual booking",
  "Rezervasiya detalları": "Booking details",
  "Rezervasiyanı redaktə et": "Edit booking",
  "Rezervasiyanı ləğv et": "Cancel booking",
  "Refund idarəsi": "Refund management",
  "Məkan seç": "Select venue",
  "Kort": "Court",
  "Kort seç": "Select court",
  "Slot açıqdır": "Slot is open",
  "bitiş": "ends",
  "Adsız istifadəçi": "Unnamed user",
  "Detallara bax": "View details",
  "Email təsdiqini sil": "Remove email verification",
  "Email təsdiqlə": "Verify email",
  "VIP badge sil": "Remove VIP badge",
  "VIP badge ver": "Give VIP badge",
  "Admin et": "Make admin",
  "Moderator et": "Make moderator",
  "Adi istifadəçi et": "Make regular user",
  "Bloku aç": "Unsuspend",
  "Blokla": "Suspend",
  "Bərpa et": "Restore",
  "Sil": "Delete",
  "İstifadəçini sil?": "Delete user?",
  "hesabı soft-delete olunacaq. Sonradan bərpa edilə bilər.": "will be soft-deleted. It can be restored later.",
  "İstifadəçini blokla": "Suspend user",
  "Blok səbəbi audit log-da saxlanacaq və admin komandası üçün görünəcək.": "The reason will be stored in the audit log and visible to admins.",
  "Səbəb": "Reason",
  "Məsələn: qayda pozuntusu, spam, ödəniş problemi...": "Example: rule violation, spam, payment issue...",
  "Badge istifadəçi profilində və admin listində görünəcək.": "The badge will appear in the user profile and admin list.",
  "Badge adı": "Badge name",
  "Bitmə tarixi": "Expiry date",
  "İstifadəçi profili": "User profile",
  "Hesab statusu, activity və admin qərarları üçün qısa icmal.": "Short account status, activity and admin decision summary.",
  "Məlumat yüklənmədi.": "Data failed to load.",
  "Oyun ləğv edildi": "Game cancelled",
  "İştirakçılar bildiriş alacaq.": "Participants will be notified.",
  "Ləğv alınmadı": "Cancel failed",
  "Oyun silindi": "Game deleted",
  "Oyun siyahılardan gizlədildi.": "Game hidden from lists.",
  "Silmək alınmadı": "Delete failed",
  "Sərbəst lokasiya": "Free location",
  "Bax": "View",
  "Oyunu ləğv et": "Cancel game",
  "Yalnız açıq/dolu oyun ləğv edilə bilər": "Only open/full games can be cancelled",
  "Oyunu sil": "Delete game",
  "Yalnız ləğv/bitmiş oyun silinə bilər": "Only cancelled/completed games can be deleted",
  "Oyunu ləğv et?": "Cancel game?",
  "tərəfindən yaradılmış": "created",
  "oyunu ləğv olunacaq.": "game will be cancelled.",
  "Məsələn: məkan texniki səbəbə görə bağlıdır": "Example: venue is closed for technical reasons",
  "Geri": "Back",
  "Ləğv edilir": "Cancelling",
  "Oyunu sil?": "Delete game?",
  "Oyun default siyahılardan gizlənəcək, audit və database qeydi saxlanacaq.": "The game will be hidden from default lists, while audit and database records remain.",
  "Silinir": "Deleting",
  "Oyun tapılmadı": "No games found",
  "Filterləri dəyişin və ya yeni oyunlar yaradıldıqda burada görünəcək.": "Change filters or wait for new games to appear.",
  "Oyunlar yüklənmədi": "Games failed to load",
  "API bağlantısını və admin sessiyasını yoxlayın.": "Check the API connection and admin session.",
  "Yenidən cəhd et": "Try again",
  "No venues match": "No venues match",
  "Are you sure you want to delete": "Are you sure you want to delete",
  "This action cannot be undone, and the venue must not have any future bookings.": "This action cannot be undone, and the venue must not have future bookings.",
  "Could not save venue": "Could not save venue",
  "Could not delete venue": "Could not delete venue",
});

const DICTIONARIES: Record<AdminLanguage, Record<string, string>> = {
  az: {},
  ru: RU,
  en: EN,
};

interface I18nContextValue {
  language: AdminLanguage;
  label: string;
  name: string;
  setLanguage: (language: AdminLanguage) => void;
  t: (text: string) => string;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

function readInitialLanguage(): AdminLanguage {
  if (typeof window === "undefined") return "az";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "ru" || stored === "en" || stored === "az" ? stored : "az";
}

export function I18nProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [language, setLanguageState] = React.useState<AdminLanguage>("az");
  const originalTextRef = React.useRef<WeakMap<Text, string>>(new WeakMap());

  React.useEffect(() => {
    const initial = readInitialLanguage();
    setLanguageState(initial);
    document.documentElement.lang = initial;
  }, []);

  const setLanguage = React.useCallback((next: AdminLanguage) => {
    setLanguageState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
  }, []);

  const t = React.useCallback(
    (text: string) => DICTIONARIES[language][text] ?? text,
    [language],
  );

  const value = React.useMemo<I18nContextValue>(
    () => ({
      language,
      label: LABELS[language],
      name: NAMES[language],
      setLanguage,
      t,
    }),
    [language, setLanguage, t],
  );

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const originals = originalTextRef.current;
    const dictionary = DICTIONARIES[language];
    const skipTags = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "OPTION"]);

    const translateTextNode = (node: Text) => {
      const parent = node.parentElement;
      if (!parent || skipTags.has(parent.tagName)) return;
      const current = node.nodeValue ?? "";
      if (!current.trim()) return;
      const original = originals.get(node) ?? current;
      originals.set(node, original);
      const leading = current.match(/^\s*/)?.[0] ?? "";
      const trailing = current.match(/\s*$/)?.[0] ?? "";
      const normalized = original.trim();
      const translated = dictionary[normalized] ?? normalized;
      node.nodeValue = `${leading}${translated}${trailing}`;
    };

    const translateRoot = (root: ParentNode) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        translateTextNode(node as Text);
        node = walker.nextNode();
      }
    };

    translateRoot(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            translateTextNode(node as Text);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            translateRoot(node as Element);
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = React.useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}

export const ADMIN_LANGUAGES: AdminLanguage[] = ["az", "ru", "en"];

export function adminLanguageLabel(language: AdminLanguage): string {
  return LABELS[language];
}

export function adminLanguageName(language: AdminLanguage): string {
  return NAMES[language];
}
