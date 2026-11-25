const commonSubjects = {
  mathematics: { ar: 'الرياضيات', en: 'Mathematics', uk: 'Математика' },
  arabic: { ar: 'اللغة العربية', en: 'Arabic', uk: 'Арабська мова' },
  english: { ar: 'اللغة الإنجليزية', en: 'English', uk: 'Англійська мова' },
  science: { ar: 'العلوم', en: 'Science', uk: 'Природничі науки' },
  'social-studies': { ar: 'الدراسات الاجتماعية', en: 'Social studies', uk: 'Суспільствознавство' },
};
const customSubjectKey = 'edumind-custom-subjects';

function readCustomSubjects() {
  try {
    const subjects = JSON.parse(localStorage.getItem(customSubjectKey));
    return Array.isArray(subjects) ? subjects.filter(item => typeof item?.name === 'string' &&
      typeof item.id === 'string' && item.id.startsWith('custom-')) : [];
  } catch {
    return [];
  }
}

function installSubjectCopy(copy) {
  const subjectCopy = {
    ar: {
      subject: 'المادة',
      addSubject: 'إضافة مادة',
      subjectName: 'اسم المادة',
      chooseStudent: 'اختر طالبًا',
      chooseOrAddStudent: 'اختر طالبًا من القائمة أو أضف طالبًا لتسجيل قياسات هذه المادة.',
      emptySubject: 'لا توجد قياسات لهذه المادة',
      enterBaseline: 'إدخال القياسات الأولية',
      saveBaseline: 'حفظ قياسات المادة',
      skill: 'المهارة التي تحتاج إلى دعم',
      exercise: 'تمرين المادة',
      saveExercise: 'حفظ التمرين',
      exerciseSaved: 'حُفظ التمرين لهذه المادة.',
      noAcademicEvidence: 'لم تُسجَّل أدلة عن مهارة محددة في هذه المادة.',
      exerciseDefault: 'اختر مهمة قصيرة من آخر درس في هذه المادة. اعرض مثالًا، ثم اطلب من الطالب حل مهمة مشابهة وشرح طريقته.',
      guided: 'اعرض مثالًا من المهارة المستهدفة وتمرّن مع الطالب مع تقديم ملاحظات مباشرة.',
      apply: 'اطلب من الطالب تطبيق المهارة في مهمة جديدة وتقليل المساعدة تدريجيًا.',
      consolidate: 'قيّم المهارة بمهمة مستقلة وراجع الأخطاء المتكررة لتحديد الخطوة التالية.',
    },
    en: {
      subject: 'Subject',
      addSubject: 'Add subject',
      subjectName: 'Subject name',
      chooseStudent: 'Choose a student',
      chooseOrAddStudent: 'Choose a student from the list or add one to record measurements for this subject.',
      emptySubject: 'No measurements for this subject',
      enterBaseline: 'Enter initial measurements',
      saveBaseline: 'Save subject measurements',
      skill: 'Skill that needs support',
      exercise: 'Subject exercise',
      saveExercise: 'Save exercise',
      exerciseSaved: 'Exercise saved for this subject.',
      noAcademicEvidence: 'No specific skill evidence was recorded for this subject.',
      exerciseDefault: 'Choose a short task from the latest lesson in this subject. Model an example, then ask the student to complete a similar task and explain their approach.',
      guided: 'Model the target skill and practice it together with immediate feedback.',
      apply: 'Have the student apply the skill to a new task, with gradually less support.',
      consolidate: 'Assess the skill with an independent task and use recurring errors to plan the next step.',
    },
    uk: {
      subject: 'Предмет',
      addSubject: 'Додати предмет',
      subjectName: 'Назва предмета',
      chooseStudent: 'Оберіть учня',
      chooseOrAddStudent: 'Оберіть учня зі списку або додайте учня, щоб внести показники з цього предмета.',
      emptySubject: 'Немає показників із цього предмета',
      enterBaseline: 'Внести початкові показники',
      saveBaseline: 'Зберегти показники з предмета',
      skill: 'Навичка, яка потребує підтримки',
      exercise: 'Вправа з предмета',
      saveExercise: 'Зберегти вправу',
      exerciseSaved: 'Вправу для цього предмета збережено.',
      noAcademicEvidence: 'Для цього предмета не зазначено навичок, які потребують підтримки.',
      exerciseDefault: 'Оберіть коротке завдання з останнього уроку. Покажіть приклад, а потім попросіть учня виконати подібне завдання й пояснити свій підхід.',
      guided: 'Покажіть, як застосувати потрібну навичку, і потренуйтеся разом, одразу даючи зворотний зв’язок.',
      apply: 'Запропонуйте учневі застосувати навичку в новому завданні, поступово зменшуючи допомогу.',
      consolidate: 'Перевірте навичку самостійним завданням і визначте наступний крок за типовими помилками.',
    },
  };

  for (const [language, labels] of Object.entries(subjectCopy)) {
    const translation = copy[language];
    Object.assign(translation, labels);
    Object.assign(translation.planFocus, {
      guided: labels.guided, apply: labels.apply, consolidate: labels.consolidate,
    });
  }
}
