document.addEventListener("DOMContentLoaded", () => {
    const form = document.querySelector(".login-form");
  
    form.addEventListener("submit", (e) => {
      e.preventDefault(); // 阻止表單自動提交
  
      const account = form.account.value.trim();
      const password = form.password.value.trim();
  
      if (account === "admin" && password === "123456") {
        //alert("登入成功！");
        // 成功後導向首頁
        window.location.href = "index.html";
      } else {
        alert("帳號或密碼錯誤！");
      }
    });
  });
  